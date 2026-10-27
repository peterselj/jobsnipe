import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

// Runs the real migration on Postgres (PGlite) with small stand-ins for the Supabase parts it uses:
// auth.users / auth.uid(), Vault, pg_net and pg_cron.
const SUPABASE_STUBS = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  create schema vault;
  create table vault.decrypted_secrets (name text, decrypted_secret text);
  create schema net;
  create table net.calls (url text, body jsonb, headers jsonb);
  create function net.http_post(url text, body jsonb, headers jsonb) returns bigint language sql as
    $$ insert into net.calls values (url, body, headers); select count(*) from net.calls $$;
  create schema cron;
  create table cron.jobs (name text, schedule text, command text);
  create function cron.schedule(n text, s text, c text) returns bigint language sql as
    $$ insert into cron.jobs values (n, s, c); select 1::bigint $$;
`;

// Every migration, in order, as Supabase would have them applied.
const migrations = readdirSync('supabase/migrations')
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8').replace(/^create extension.*$/gm, ''));

const JOSH = '00000000-0000-0000-0000-00000000000a';
const JAKE = '00000000-0000-0000-0000-00000000000b';

let db: PGlite;

/** Run SQL as a signed-in user (or anon when `who` is null), the way PostgREST would. */
async function as<T = Record<string, unknown>>(who: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${who ? 'authenticated' : 'anon'}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [who ?? '']);
    return (await tx.query<T>(sql, params)).rows;
  });
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUBS);
  for (const m of migrations) await db.exec(m);
  await db.exec(`insert into auth.users values ('${JOSH}', 'josh@example.com'), ('${JAKE}', 'jake@example.com')`);
}, 30_000);

describe('database', () => {
  it('creates a profile on first sign-in and schedules the hourly check', async () => {
    const rows = (await db.query<{ id: string; email: string; name: string }>('select id, email, name from profiles order by email')).rows;
    expect(rows.map((r) => [r.email, r.name])).toEqual([['jake@example.com', 'jake'], ['josh@example.com', 'josh']]);
    expect((await db.query('select * from cron.jobs')).rows).toEqual([
      { name: 'jobsnipe-hourly', schedule: '17 * * * *', command: "select public.dispatch_check('schedule')" },
    ]);
  });

  it('lets people see and edit only their own profile, and only the allowed columns', async () => {
    expect(await as(JOSH, 'select email from profiles')).toEqual([{ email: 'josh@example.com' }]);
    await as(JOSH, `update profiles set criteria = '{"titles":{"include":["product manager"]}}', name = 'Josh'`);
    expect((await db.query(`select name from profiles where id = '${JOSH}'`)).rows).toEqual([{ name: 'Josh' }]);
    await as(JAKE, `update profiles set name = 'hacked' where id = '${JOSH}'`); // RLS: silently matches no rows
    expect((await db.query(`select name from profiles where id = '${JOSH}'`)).rows).toEqual([{ name: 'Josh' }]);
    await expect(as(JOSH, `update profiles set id = '${JAKE}'`)).rejects.toThrow(/permission denied/);
    expect(await as(null, 'select * from profiles')).toEqual([]);
  });

  it('adds watches through add_watch, sharing one board row between people', async () => {
    await as(JOSH, `select add_watch('Acme', 'greenhouse', 'acme')`);
    await as(JAKE, `select add_watch('Acme Corp', 'greenhouse', 'acme')`);
    await as(JOSH, `select add_watch('Corner Store', null, null, 'https://corner.example/jobs', 'own site')`);
    expect((await db.query('select ats, board from companies')).rows).toEqual([{ ats: 'greenhouse', board: 'acme' }]);
    expect(await as(JOSH, 'select name, company_id is null as unmonitored from watches order by id')).toEqual([
      { name: 'Acme', unmonitored: false },
      { name: 'Corner Store', unmonitored: true },
    ]);
    expect(await as(JAKE, 'select name from watches')).toEqual([{ name: 'Acme Corp' }]);
    await expect(as(JOSH, `select add_watch('Acme again', 'greenhouse', 'acme')`)).rejects.toThrow(/Already watching/);
    await expect(as(JOSH, `insert into watches (profile_id, name) values ('${JOSH}', 'x')`)).rejects.toThrow(/permission denied/);
    await expect(as(null, `select add_watch('x', 'lever', 'x')`)).rejects.toThrow(/permission denied/);
  });

  it('changes a board and resets the summary; removes only own watches', async () => {
    const [w] = await as<{ id: number }>(JOSH, `select id from watches where name = 'Corner Store'`);
    await db.exec(`update watches set baselined_at = now() where id = ${w.id}`);
    await as(JOSH, `select change_watch_board(${w.id}, 'ashby', 'cornerstore')`);
    expect(await as(JOSH, `select w.baselined_at, c.board from watches w join companies c on c.id = w.company_id where w.id = ${w.id}`)).toEqual([
      { baselined_at: null, board: 'cornerstore' },
    ]);
    await expect(as(JAKE, `select change_watch_board(${w.id}, 'lever', 'x')`)).rejects.toThrow(/no longer in your list/);
    await as(JAKE, `delete from watches where id = ${w.id}`);
    expect(await as(JOSH, `select count(*)::int as n from watches`)).toEqual([{ n: 2 }]);
  });

  it('keeps matches and verdicts private per person', async () => {
    await db.exec(`
      insert into postings (id, company_id, title, url) select 'greenhouse:acme:1', id, 'Senior PM', 'https://x' from companies where board = 'acme';
      insert into matches (profile_id, posting_id, where_label) values ('${JOSH}', 'greenhouse:acme:1', 'NYC area');
    `);
    expect(await as(JOSH, 'select where_label from matches')).toEqual([{ where_label: 'NYC area' }]);
    expect(await as(JAKE, 'select * from matches')).toEqual([]);
    expect(await as(JAKE, 'select title from postings')).toEqual([{ title: 'Senior PM' }]);
    await as(JOSH, `insert into verdicts (profile_id, posting_id, verdict, reason) values ('${JOSH}', 'greenhouse:acme:1', 'not_for_me', 'too junior')`);
    await expect(as(JAKE, `insert into verdicts (profile_id, posting_id, verdict) values ('${JOSH}', 'greenhouse:acme:1', 'interested')`)).rejects.toThrow(/row-level security/);
    expect(await as(JAKE, 'select * from verdicts')).toEqual([]);
    await expect(as(JOSH, `insert into matches (profile_id, posting_id) values ('${JOSH}', 'greenhouse:acme:1')`)).rejects.toThrow(/row-level security/);
  });

  it("never shows anyone else's target companies or their postings", async () => {
    const STRANGER = '00000000-0000-0000-0000-00000000000c';
    await db.exec(`insert into auth.users values ('${STRANGER}', 'stranger@example.com')`);
    // Josh alone watches the Corner Store board (ashby/cornerstore); Jake and Josh both watch Acme.
    await db.exec(`insert into postings (id, company_id, title, url) select 'ashby:cornerstore:1', id, 'Head of Product', 'https://y' from companies where board = 'cornerstore'`);
    expect(await as(STRANGER, 'select * from companies')).toEqual([]);
    expect(await as(STRANGER, 'select * from postings')).toEqual([]);
    expect(await as(JAKE, 'select board from companies')).toEqual([{ board: 'acme' }]);
    expect(await as(JAKE, `select id from postings where id like 'ashby:%'`)).toEqual([]);
    expect(await as(JOSH, 'select board from companies order by board')).toEqual([{ board: 'acme' }, { board: 'cornerstore' }]);
    expect(await as(JOSH, `select title from postings where id = 'ashby:cornerstore:1'`)).toEqual([{ title: 'Head of Product' }]);
  });

  it('Check now calls GitHub with the Vault key, at most once a minute', async () => {
    await expect(as(JOSH, `select request_check()`)).rejects.toThrow(/github_dispatch_token/);
    await db.exec(`insert into vault.decrypted_secrets values ('github_dispatch_token', 'ghp_test')`);
    await as(JOSH, `select request_check()`);
    await as(JAKE, `select request_check()`);
    const calls = (await db.query<{ url: string; body: any; headers: any }>('select * from net.calls')).rows;
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.github.com/repos/peterselj/jobsnipe/actions/workflows/check.yml/dispatches');
    expect(calls[0].body).toEqual({ ref: 'main', inputs: { reason: 'check now' } });
    expect(calls[0].headers.Authorization).toBe('Bearer ghp_test');
    await expect(as(JOSH, `select dispatch_check('x')`)).rejects.toThrow(/permission denied/);
    await expect(as(null, `select request_check()`)).rejects.toThrow(/permission denied/);
  });
});
