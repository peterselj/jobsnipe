import { describe, expect, it } from 'vitest';
import { findBoards, parseBoardUrl, slugCandidates } from '../src/lib/ats';
import { addCompany, listCompanies, removeCompany, replaceCompany } from '../src/lib/profileYaml';
import { GitHubSource } from '../src/lib/source';

const PROFILE = `# Sample profile
id: sam
name: Sam
companies:
  - { name: Acme, ats: greenhouse, board: acme } # keep this comment
  - { name: Globex, ats: lever, board: globex }
  - name: Initech
    ats: none
    note: posts on its own site
`;

describe('profile YAML edits', () => {
  it('lists companies', () => {
    expect(listCompanies(PROFILE).map((c) => c.name)).toEqual(['Acme', 'Globex', 'Initech']);
  });

  it('adds in the same one-line style and keeps comments', () => {
    const out = addCompany(PROFILE, { name: 'Hooli', ats: 'ashby', board: 'hooli' });
    expect(out).toContain('- { name: Hooli, ats: ashby, board: hooli }');
    expect(out).toContain('# keep this comment');
    expect(out).toContain('# Sample profile');
    expect(listCompanies(out)).toHaveLength(4);
  });

  it('writes not-monitored entries as a block', () => {
    const out = addCompany(PROFILE, { name: 'Soylent', ats: 'none', note: 'job board not found yet', careers_url: 'https://soylent.example/careers' });
    expect(listCompanies(out).at(-1)).toEqual({ name: 'Soylent', ats: 'none', note: 'job board not found yet', careers_url: 'https://soylent.example/careers' });
  });

  it('refuses duplicates', () => {
    expect(() => addCompany(PROFILE, { name: 'Acme again', ats: 'greenhouse', board: 'ACME' })).toThrow(/Already watching/);
  });

  it('replaces a board and removes a company', () => {
    const fixed = replaceCompany(PROFILE, 2, { name: 'Initech', ats: 'ashby', board: 'initech' });
    expect(listCompanies(fixed)[2]).toEqual({ name: 'Initech', ats: 'ashby', board: 'initech' });
    expect(listCompanies(removeCompany(PROFILE, 0)).map((c) => c.name)).toEqual(['Globex', 'Initech']);
  });
});

describe('finding boards', () => {
  it('recognizes job links', () => {
    expect(parseBoardUrl('https://jobs.ashbyhq.com/acme/997cb772')).toEqual({ ats: 'ashby', board: 'acme' });
    expect(parseBoardUrl('job-boards.greenhouse.io/globexinc/jobs/4597185006')).toEqual({ ats: 'greenhouse', board: 'globexinc' });
    expect(parseBoardUrl('https://boards.greenhouse.io/embed/job_board?for=acme')).toEqual({ ats: 'greenhouse', board: 'acme' });
    expect(parseBoardUrl('https://jobs.lever.co/initech/62700386/apply')).toEqual({ ats: 'lever', board: 'initech' });
    expect(parseBoardUrl('https://careers.example.com/jobs?gh_jid=1')).toBeUndefined();
  });

  it('guesses slugs including acronyms', () => {
    const s = slugCandidates('The Acme Robotics Group, Inc.');
    expect(s).toEqual(expect.arrayContaining(['acmeroboticsgroup', 'acme-robotics-group', 'arg', 'theacmeroboticsgroup']));
  });

  it('probes every ATS and sorts the busiest first', async () => {
    const fake = (async (url: string) => {
      const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url === 'https://boards-api.greenhouse.io/v1/boards/acme/jobs') return ok({ jobs: [{ title: 'PM', company_name: 'Acme Corp' }] });
      if (url === 'https://api.ashbyhq.com/posting-api/job-board/acme') return ok({ jobs: [{ title: 'A' }, { title: 'B' }, { title: 'C', isListed: false }] });
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    const hits = await findBoards('Acme', fake);
    expect(hits.map((h) => [h.ats, h.board, h.jobs])).toEqual([['ashby', 'acme', 2], ['greenhouse', 'acme', 1]]);
    expect(hits[1].displayName).toBe('Acme Corp');
  });
});

/** A tiny in-memory GitHub: files per branch, with shas that change on every write. */
function fakeGitHub() {
  const files: Record<string, { text: string; sha: string }> = { 'main:profiles/sam.yaml': { text: PROFILE, sha: 's0' } };
  const branches = new Set(['main', 'state']);
  const calls: string[] = [];
  let n = 0;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const impl = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const path = url.pathname.replace('/repos/me/backend', '');
    const method = init.method ?? 'GET';
    calls.push(`${method} ${path}`);
    if (path === '') return json({ default_branch: 'main' });
    if (path.startsWith('/git/ref/heads/')) {
      const b = decodeURIComponent(path.slice('/git/ref/heads/'.length));
      return branches.has(b) ? json({ object: { sha: 'c1' } }) : json({ message: 'Not Found' }, 404);
    }
    if (path === '/git/refs' && method === 'POST') {
      branches.add(JSON.parse(init.body as string).ref.replace('refs/heads/', ''));
      return json({}, 201);
    }
    if (path.startsWith('/contents/')) {
      const file = path.slice('/contents/'.length);
      if (method === 'PUT') {
        const body = JSON.parse(init.body as string);
        const key = `${body.branch}:${file}`;
        if (!branches.has(body.branch)) return json({ message: 'Branch not found' }, 404);
        if (files[key] && files[key].sha !== body.sha) return json({ message: 'sha mismatch' }, 409);
        files[key] = { text: new TextDecoder().decode(Uint8Array.from(atob(body.content), (c) => c.charCodeAt(0))), sha: `s${++n}` };
        return json({ content: { sha: files[key].sha } });
      }
      const f = files[`${url.searchParams.get('ref')}:${file}`];
      if (!f) return json({ message: 'Not Found' }, 404);
      const raw = (init.headers as Record<string, string>).Accept.includes('raw');
      if (raw) return new Response(f.text, { status: 200 });
      const bytes = new TextEncoder().encode(f.text);
      return json({ content: btoa(String.fromCharCode(...bytes)), sha: f.sha });
    }
    if (path.endsWith('/dispatches')) return new Response(null, { status: 204 });
    return json({ message: 'Not Found' }, 404);
  }) as unknown as typeof fetch;
  return { impl, files, branches, calls };
}

describe('GitHubSource', () => {
  const conn = { token: 't', repo: 'me/backend', profile: 'sam' };

  it('edits the profile on main with the current sha', async () => {
    const gh = fakeGitHub();
    const src = new GitHubSource(conn, gh.impl);
    await src.updateProfile((t) => addCompany(t, { name: 'Hooli', ats: 'ashby', board: 'hooli' }), 'Add Hooli');
    await src.updateProfile((t) => removeCompany(t, 0), 'Remove Acme');
    expect(listCompanies(gh.files['main:profiles/sam.yaml'].text).map((c) => c.name)).toEqual(['Globex', 'Initech', 'Hooli']);
  });

  it('creates the feedback branch on first use and handles rapid clicks in order', async () => {
    const gh = fakeGitHub();
    const src = new GitHubSource(conn, gh.impl);
    const v = (verdict: 'interested' | 'not_for_me') => ({ verdict, at: 'now', company: 'Acme', title: 'PM' });
    const results = await Promise.all([src.setVerdict('p1', v('interested')), src.setVerdict('p2', v('not_for_me')), src.setVerdict('p1', null)]);
    expect(gh.branches.has('feedback')).toBe(true);
    expect(Object.keys(results[2])).toEqual(['p2']);
    expect(JSON.parse(gh.files['feedback:feedback/sam.json'].text)).toEqual({ p2: v('not_for_me') });
    expect(await src.loadFeedback()).toEqual({ p2: v('not_for_me') });
  });

  it('starts the hourly workflow on demand', async () => {
    const gh = fakeGitHub();
    await new GitHubSource(conn, gh.impl).startCheck();
    expect(gh.calls).toContain('POST /actions/workflows/fast-lane.yml/dispatches');
  });
});
