-- JobSnipe database. Run once in Supabase → SQL Editor (paste all, then Run).
--
-- Who sees what: everyone signed in can read the shared job data (companies, postings, run times).
-- Each person can only read and change their own profile, watches, matches and verdicts.
-- The checker uses the secret key, which bypasses these rules.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ───────────── People ─────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  -- Where alerts go; starts as the sign-in address.
  email text not null,
  -- Filters as one JSON document (titles, seniority, locations, remote, comp_floor), so a filter or
  -- context cue can be added or dropped without a migration. Shape: checker/src/types.ts `Criteria`.
  criteria jsonb not null default '{}'::jsonb,
  alert_mode text not null default 'immediate' check (alert_mode in ('immediate', 'hourly', 'daily', 'weekly')),
  created_at timestamptz not null default now()
);

-- A profile row appears automatically the first time someone signs in.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, name)
  values (new.id, new.email, split_part(new.email, '@', 1));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────── Shared job data ─────────────

-- One row per job board, however many people watch it, so each board is fetched once per run.
create table public.companies (
  id bigint generated always as identity primary key,
  ats text not null check (ats in ('greenhouse', 'lever', 'ashby')),
  board text not null,
  name text not null,
  last_checked_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  consecutive_failures int not null default 0,
  failure_alert_sent boolean not null default false,
  open_postings int,
  unique (ats, board)
);

create table public.postings (
  id text primary key, -- `${ats}:${board}:${external id}`
  company_id bigint not null references public.companies (id) on delete cascade,
  title text not null,
  locations text[] not null default '{}',
  workplace text,
  url text not null,
  ats_posted_at timestamptz,
  comp_min int,
  comp_max int,
  comp_currency text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index postings_company_idx on public.postings (company_id);

create table public.runs (
  id bigint generated always as identity primary key,
  trigger text not null default 'schedule',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  companies_checked int,
  new_postings int,
  alerts_sent int,
  errors jsonb not null default '[]'::jsonb
);

-- ───────────── Per person ─────────────

-- Which companies a person follows. company_id null = listed but not monitored (no readable board).
create table public.watches (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  company_id bigint references public.companies (id) on delete cascade,
  name text not null,
  careers_url text,
  note text,
  created_at timestamptz not null default now(),
  -- Set once the "now watching" summary has been sent. Postings first seen after this alert one by one.
  baselined_at timestamptz,
  unique (profile_id, company_id)
);

-- Open postings that pass a person's filters, rewritten by the checker each run.
create table public.matches (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  posting_id text not null references public.postings (id) on delete cascade,
  where_label text,
  flags text[] not null default '{}',
  primary key (profile_id, posting_id)
);

-- Interested / Not for me. No foreign key to postings, so feedback outlives the posting.
create table public.verdicts (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  posting_id text not null,
  verdict text not null check (verdict in ('interested', 'not_for_me')),
  reason text,
  company text,
  title text,
  url text,
  created_at timestamptz not null default now(),
  primary key (profile_id, posting_id)
);

create table public.alerts (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  posting_id text not null,
  sent_at timestamptz not null default now(),
  primary key (profile_id, posting_id)
);

create table public.check_requests (
  id bigint generated always as identity primary key,
  requested_by uuid,
  reason text not null,
  requested_at timestamptz not null default now()
);

-- ───────────── Row-level security ─────────────

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.postings enable row level security;
alter table public.runs enable row level security;
alter table public.watches enable row level security;
alter table public.matches enable row level security;
alter table public.verdicts enable row level security;
alter table public.alerts enable row level security;
alter table public.check_requests enable row level security;

create policy "read own profile" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "update own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "read job boards" on public.companies for select to authenticated using (true);
create policy "read postings" on public.postings for select to authenticated using (true);
create policy "read runs" on public.runs for select to authenticated using (true);

create policy "read own watches" on public.watches for select to authenticated using (profile_id = (select auth.uid()));
create policy "remove own watches" on public.watches for delete to authenticated using (profile_id = (select auth.uid()));

create policy "read own matches" on public.matches for select to authenticated using (profile_id = (select auth.uid()));

create policy "read own verdicts" on public.verdicts for select to authenticated using (profile_id = (select auth.uid()));
create policy "add own verdicts" on public.verdicts for insert to authenticated with check (profile_id = (select auth.uid()));
create policy "change own verdicts" on public.verdicts for update to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));
create policy "remove own verdicts" on public.verdicts for delete to authenticated using (profile_id = (select auth.uid()));

-- Profiles: people may edit their name, alert email, filters and alert mode, nothing else.
revoke update on public.profiles from anon, authenticated;
grant update (name, email, criteria, alert_mode) on public.profiles to authenticated;
-- Watches change only through the functions below (they also maintain the shared companies table).
revoke insert, update on public.watches from anon, authenticated;

-- ───────────── Starting a check ─────────────

-- Starts the checker on GitHub Actions. The GitHub key is kept in Supabase Vault (see docs/SETUP.md).
create function public.dispatch_check(p_reason text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  token text;
begin
  select decrypted_secret into token from vault.decrypted_secrets where name = 'github_dispatch_token';
  if token is null then
    raise exception 'No github_dispatch_token in Vault; see docs/SETUP.md';
  end if;
  return net.http_post(
    url := 'https://api.github.com/repos/peterselj/jobsnipe/actions/workflows/check.yml/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('reason', p_reason)),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'jobsnipe',
      'Content-Type', 'application/json'
    )
  );
end $$;
revoke execute on function public.dispatch_check(text) from public, anon, authenticated;

-- "Check now" from the page. Requests within a minute of the last one share it.
create function public.request_check(p_reason text default 'check now') returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  last_at timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first';
  end if;
  select max(requested_at) into last_at from public.check_requests;
  if last_at is not null and last_at > now() - interval '60 seconds' then
    return last_at;
  end if;
  insert into public.check_requests (requested_by, reason) values ((select auth.uid()), p_reason);
  perform public.dispatch_check(p_reason);
  return now();
end $$;
revoke execute on function public.request_check(text) from public, anon;
grant execute on function public.request_check(text) to authenticated;

-- ───────────── Managing watched companies ─────────────

create function public.company_id_for(p_ats text, p_board text, p_name text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  cid bigint;
begin
  insert into public.companies (ats, board, name) values (p_ats, p_board, p_name)
    on conflict (ats, board) do nothing;
  select id into cid from public.companies where ats = p_ats and board = p_board;
  return cid;
end $$;
revoke execute on function public.company_id_for(text, text, text) from public, anon, authenticated;

-- Add a company to watch. p_ats null (or 'none') lists it as not monitored.
create function public.add_watch(p_name text, p_ats text default null, p_board text default null,
                                 p_careers_url text default null, p_note text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  cid bigint;
  wid bigint;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the company a name'; end if;
  if p_ats is not null and p_ats <> 'none' then
    cid := public.company_id_for(p_ats, p_board, trim(p_name));
    if exists (select 1 from public.watches where profile_id = me and company_id = cid) then
      raise exception 'Already watching that board';
    end if;
  end if;
  insert into public.watches (profile_id, company_id, name, careers_url, note)
    values (me, cid, trim(p_name), nullif(trim(p_careers_url), ''), nullif(trim(p_note), ''))
    returning id into wid;
  return wid;
end $$;
revoke execute on function public.add_watch(text, text, text, text, text) from public, anon;
grant execute on function public.add_watch(text, text, text, text, text) to authenticated;

-- Point a watched company at a different board (e.g. the guess was wrong, or they switched ATS).
create function public.change_watch_board(p_watch_id bigint, p_ats text, p_board text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  w public.watches;
  cid bigint;
begin
  select * into w from public.watches where id = p_watch_id and profile_id = me;
  if w.id is null then raise exception 'That company is no longer in your list'; end if;
  cid := public.company_id_for(p_ats, p_board, w.name);
  if exists (select 1 from public.watches where profile_id = me and company_id = cid and id <> w.id) then
    raise exception 'Already watching that board';
  end if;
  -- A new board means a fresh "now watching" summary rather than an email per existing posting.
  update public.watches set company_id = cid, baselined_at = null, note = null where id = w.id;
end $$;
revoke execute on function public.change_watch_board(bigint, text, text) from public, anon;
grant execute on function public.change_watch_board(bigint, text, text) to authenticated;

-- ───────────── Hourly schedule ─────────────

-- Minute 17 avoids the top-of-hour rush on GitHub.
select cron.schedule('jobsnipe-hourly', '17 * * * *', $$select public.dispatch_check('schedule')$$);
