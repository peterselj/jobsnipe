import { describe, expect, it } from 'vitest';
import { boardLabel, boardUrl, companyFromSiteUrl, findBoards, parseBoardUrl, slugCandidates } from '../src/lib/ats';

describe('finding boards', () => {
  it('recognizes job links', () => {
    expect(parseBoardUrl('https://jobs.ashbyhq.com/acme/997cb772')).toEqual({ ats: 'ashby', board: 'acme' });
    expect(parseBoardUrl('job-boards.greenhouse.io/globexinc/jobs/4597185006')).toEqual({ ats: 'greenhouse', board: 'globexinc' });
    expect(parseBoardUrl('https://boards.greenhouse.io/embed/job_board?for=acme')).toEqual({ ats: 'greenhouse', board: 'acme' });
    expect(parseBoardUrl('https://jobs.lever.co/initech/62700386/apply')).toEqual({ ats: 'lever', board: 'initech' });
    expect(parseBoardUrl('https://careers.example.com/jobs?gh_jid=1')).toBeUndefined();
  });

  it('recognizes Workday links in their several shapes', () => {
    const nvidia = { ats: 'workday', board: 'nvidia.wd5.myworkdayjobs.com/nvidia/NVIDIAExternalCareerSite' };
    expect(parseBoardUrl('https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Senior-Engineer_JR2028861')).toEqual(nvidia);
    expect(parseBoardUrl('nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite')).toEqual(nvidia);
    expect(parseBoardUrl('https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs')).toEqual(nvidia);
    expect(parseBoardUrl('https://wd3.myworkdaysite.com/en-US/recruiting/acme/External/job/x_R1')).toEqual({ ats: 'workday', board: 'wd3.myworkdaysite.com/acme/External' });
    expect(parseBoardUrl('https://nvidia.wd5.myworkdayjobs.com/')).toBeUndefined();
    expect(boardUrl('workday', nvidia.board)).toBe('https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite');
    expect(boardLabel('workday', nvidia.board)).toBe('nvidia / NVIDIAExternalCareerSite');
  });

  it("reads the company's name from its own careers-site address", () => {
    expect(companyFromSiteUrl('https://careers.doordash.com/jobs/123')).toBe('doordash');
    expect(companyFromSiteUrl('careersatdoordash.com')).toBe('doordash');
    expect(companyFromSiteUrl('https://www.workday.com/en-us/company/careers.html')).toBe('workday');
    expect(companyFromSiteUrl('https://jobs.acme.co.uk/')).toBe('acme');
    expect(companyFromSiteUrl('DoorDash')).toBeUndefined();
  });

  it('guesses slugs including acronyms and country suffixes', () => {
    expect(slugCandidates('DoorDash')).toContain('doordashusa');
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

  it("finds the board behind a company's own careers site, preferring the one with the linked job", async () => {
    const fake = (async (url: string) => {
      const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url === 'https://boards-api.greenhouse.io/v1/boards/doordash/jobs') return ok({ jobs: [{ id: 1, title: 'Old' }, { id: 2, title: 'Old' }, { id: 3, title: 'Old' }] });
      if (url === 'https://boards-api.greenhouse.io/v1/boards/doordashusa/jobs') return ok({ jobs: [{ id: 8139265, title: 'PM', company_name: 'DoorDash USA' }] });
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    const hits = await findBoards('https://careersatdoordash.com/jobs/pm?gh_jid=8139265', fake);
    expect(hits.map((h) => [h.board, h.hasJob])).toEqual([['doordashusa', true], ['doordash', false]]);
  });

  it('finds boards checked by hand from a name or the company\'s own site', async () => {
    const nothing = (async () => new Response('not found', { status: 404 })) as typeof fetch;
    const nvidia = { ats: 'workday', board: 'nvidia.wd5.myworkdayjobs.com/nvidia/NVIDIAExternalCareerSite', sample: [], displayName: 'NVIDIA' };
    expect(await findBoards('nvidia', nothing)).toEqual([nvidia]);
    expect(await findBoards('NVIDIA Corporation', nothing)).toEqual([nvidia]);
    expect(await findBoards('https://jobs.nvidia.com/careers', nothing)).toEqual([nvidia]);
  });

  it("takes a Workday link as given, since the page can't read Workday", async () => {
    const fake = (async () => { throw new Error('should not fetch'); }) as unknown as typeof fetch;
    expect(await findBoards('https://acme.wd1.myworkdayjobs.com/External/job/x_R1', fake)).toEqual([
      { ats: 'workday', board: 'acme.wd1.myworkdayjobs.com/acme/External', sample: [] },
    ]);
  });
});

describe('adding a role by hand', () => {
  it('reads the role from a job page title, however the site words it', async () => {
    const { roleFromPage } = await import('../src/lib/addRole');
    const li = 'https://www.linkedin.com/jobs/view/4012345678/?trackingId=abc';
    expect(roleFromPage(li, '(3) Senior Product Manager | Acme Robotics | LinkedIn')).toEqual({ url: 'https://www.linkedin.com/jobs/view/4012345678/', title: 'Senior Product Manager', company: 'Acme Robotics' });
    expect(roleFromPage(li, 'Acme hiring Senior Product Manager in New York, NY | LinkedIn')).toMatchObject({ title: 'Senior Product Manager', company: 'Acme' });
    expect(roleFromPage('https://www.linkedin.com/jobs/search/?currentJobId=77&keywords=pm', 'Staff PM | Beta | LinkedIn').url).toBe('https://www.linkedin.com/jobs/view/77/');
    expect(roleFromPage('https://job-boards.greenhouse.io/acme/jobs/123', 'Job Application for Senior PM at Acme')).toMatchObject({ title: 'Senior PM', company: 'Acme' });
    expect(roleFromPage('https://jobs.lever.co/acme/0b1c2d3e-4f5a-6b7c-8d9e-0f1a2b3c4d5e', 'Acme - Senior PM, Growth')).toMatchObject({ title: 'Senior PM, Growth', company: 'Acme' });
    expect(roleFromPage('https://jobs.ashbyhq.com/acme/x', 'Senior PM @ Acme')).toMatchObject({ title: 'Senior PM', company: 'Acme' });
    expect(roleFromPage('https://www.indeed.com/viewjob?jk=1', 'Senior PM - Acme - New York, NY - Indeed.com')).toMatchObject({ title: 'Senior PM', company: 'Acme' });
    expect(roleFromPage('https://careers.example.com/jobs/9?utm_source=x', 'Head of Product')).toEqual({ url: 'https://careers.example.com/jobs/9', title: 'Head of Product', company: 'Example' });
  });

  it('gives the same job the same id, and refuses links that are not web addresses', async () => {
    const { cleanRoleUrl, manualId } = await import('../src/lib/addRole');
    expect(manualId('https://www.linkedin.com/jobs/view/42/?trk=a')).toBe(manualId('https://www.linkedin.com/comm/jobs/view/senior-pm-at-acme-42?refId=b'));
    expect(manualId('https://www.linkedin.com/jobs/view/42/')).not.toBe(manualId('https://www.linkedin.com/jobs/view/43/'));
    expect(cleanRoleUrl('javascript:alert(1)')).toBeUndefined();
  });

  it('fills in Greenhouse and Lever roles from their public APIs, and asks LinkedIn nothing', async () => {
    const { lookUpRole } = await import('../src/lib/addRole');
    const asked: string[] = [];
    const fake = (async (url: string) => {
      asked.push(url);
      return Response.json(url.includes('greenhouse') ? { title: 'Senior PM', company_name: 'Acme Inc' } : { text: 'Lead PM' });
    }) as unknown as typeof fetch;
    expect(await lookUpRole('https://boards.greenhouse.io/acme/jobs/123?gh_src=x', fake)).toEqual({ title: 'Senior PM', company: 'Acme Inc' });
    expect(await lookUpRole('https://jobs.lever.co/acme/0b1c2d3e-4f5a-6b7c-8d9e-0f1a2b3c4d5e', fake)).toEqual({ title: 'Lead PM', company: 'Acme' });
    expect(await lookUpRole('https://www.linkedin.com/jobs/view/42/', fake)).toBeUndefined();
    expect(asked).toEqual(['https://boards-api.greenhouse.io/v1/boards/acme/jobs/123', 'https://api.lever.co/v0/postings/acme/0b1c2d3e-4f5a-6b7c-8d9e-0f1a2b3c4d5e']);
  });

  it('safeHttpUrl keeps web links and drops the rest', async () => {
    const { safeHttpUrl } = await import('../shared/url');
    expect(safeHttpUrl('https://x.example/a?b=1')).toBe('https://x.example/a?b=1');
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'JAVASCRIPT:alert(1)', ' vbscript:x', 'not a link', '', null, undefined]) expect(safeHttpUrl(bad)).toBeUndefined();
  });
});

describe('title entries that are too broad', () => {
  it('flags a level word by itself, and nothing else', async () => {
    const { tooBroadTitles } = await import('../shared/criteria');
    expect(tooBroadTitles(['product manager', 'Director', 'director of product', ' lead ', 'head of product', 'designer'])).toEqual(['director', 'lead']);
    expect(tooBroadTitles(undefined)).toEqual([]);
  });
});

describe('SmartRecruiters and Recruitee links, and Discover filters', () => {
  it('recognizes the new boards from their links', () => {
    expect(parseBoardUrl('https://jobs.smartrecruiters.com/AcmeInc/744000012345-senior-product-manager')).toEqual({ ats: 'smartrecruiters', board: 'AcmeInc' });
    expect(parseBoardUrl('careers.smartrecruiters.com/AcmeInc')).toEqual({ ats: 'smartrecruiters', board: 'AcmeInc' });
    expect(parseBoardUrl('https://api.smartrecruiters.com/v1/companies/AcmeInc/postings')).toEqual({ ats: 'smartrecruiters', board: 'AcmeInc' });
    expect(parseBoardUrl('https://acme.recruitee.com/o/senior-pm')).toEqual({ ats: 'recruitee', board: 'acme' });
    expect(parseBoardUrl('https://www.recruitee.com/pricing')).toBeUndefined();
    expect(boardUrl('smartrecruiters', 'AcmeInc')).toBe('https://jobs.smartrecruiters.com/AcmeInc');
    expect(boardUrl('recruitee', 'acme')).toBe('https://acme.recruitee.com');
    expect(boardUrl('recruitee', 'evil.example.com/x')).toBe('https://recruitee.com');
  });

  it('a pasted SmartRecruiters link shows how many jobs are there; a Recruitee link is taken as given', async () => {
    const asked: string[] = [];
    const fake = (async (url: string) => {
      asked.push(url);
      return Response.json({ totalFound: 42, content: [{ name: 'Senior PM', company: { name: 'Acme Inc' } }] });
    }) as unknown as typeof fetch;
    expect(await findBoards('https://jobs.smartrecruiters.com/AcmeInc/744-senior-pm', fake)).toEqual([{ ats: 'smartrecruiters', board: 'AcmeInc', jobs: 42, sample: ['Senior PM'], displayName: 'Acme Inc' }]);
    expect(await findBoards('https://acme.recruitee.com/o/x', fake)).toEqual([{ ats: 'recruitee', board: 'acme', sample: [] }]);
    expect(asked).toEqual(['https://api.smartrecruiters.com/v1/companies/AcmeInc/postings?limit=3']);
  });

  it('Discover filters skip the industries and stages you name', async () => {
    const { discoverSkip, stageLabel } = await import('../shared/criteria');
    const f = { skip_industries: ['biotech', ' Pharma '], skip_stages: ['pre_seed'] };
    expect(discoverSkip(f, { stage: 'series_b', industries: ['Biotechnology', 'Health Care'] })).toBe('industry: Biotechnology');
    expect(discoverSkip(f, { stage: 'pre_seed', industries: ['Fintech'] })).toBe('stage: Pre-seed');
    expect(discoverSkip(f, { stage: 'series_b', industries: ['Fintech'] })).toBeUndefined();
    expect(discoverSkip(f, {})).toBeUndefined(); // jobs from alert emails say neither
    expect(discoverSkip(undefined, { stage: 'pre_seed' })).toBeUndefined();
    expect([stageLabel('series_b'), stageLabel('ipo'), stageLabel('seed')]).toEqual(['Series B', 'Public (IPO)', 'Seed']);
  });
});

describe('suggestions from your decisions', () => {
  const at = '2026-11-10T00:00:00Z';
  const v = (verdict: 'interested' | 'not_for_me', title: string, company = 'Acme', reason?: string) => ({ verdict, title, company, at, reason });
  const criteria = {
    titles: { include: ['product manager'], exclude: ['intern'] },
    comp_floor: { USD: 140000 },
    max_age_days: 30,
  };
  const role = (id: string, over: object = {}) => ({ id, company: 'Acme', title: 'Senior Product Manager', url: 'https://x', flags: [], firstSeenAt: at, ...over });

  it('suggests skipping a title word you keep passing on, and never one you also starred', async () => {
    const { suggest } = await import('../src/lib/suggest');
    const feedback = {
      a: v('not_for_me', 'Senior Technical Product Manager', 'Acme', 'too technical'),
      b: v('not_for_me', 'Technical Product Manager, Infra', 'Beta'),
      c: v('not_for_me', 'Staff Technical Product Manager', 'Gamma'),
      d: v('not_for_me', 'Senior Product Manager, Growth', 'Acme'),
      e: v('not_for_me', 'Product Manager, Growth', 'Beta'),
      f: v('not_for_me', 'Lead Product Manager, Growth', 'Gamma'),
      g: v('interested', 'Group Product Manager, Growth', 'Delta'), // starred a Growth role: no suggestion for it
    };
    const inbox = [role('m1', { title: 'Principal Technical Product Manager' }), role('m2')];
    const s = suggest({ criteria, feedback, matches: inbox, watches: [] });
    expect(s.map((x) => x.id)).toEqual(['title:technical']);
    expect(s[0].text).toBe('Skip titles containing “technical”?');
    expect(s[0].why).toMatch(/passed on 3 roles .* clear 1 role waiting/);
    expect(s[0].evidence).toHaveLength(3);
    expect(s[0].criteria!.titles).toEqual({ include: ['product manager'], exclude: ['intern', 'technical'] });
    // Two decisions aren't a pattern, and a dismissed suggestion stays gone.
    const { a: _a, ...fewer } = feedback;
    expect(suggest({ criteria, feedback: fewer, matches: [], watches: [] })).toEqual([]);
    const { dismiss } = await import('../src/lib/suggest');
    expect(suggest({ criteria: dismiss(criteria, 'title:technical'), feedback, matches: inbox, watches: [] })).toEqual([]);
  });

  it('suggests a lower pay floor and a longer age limit when you star what they hid', async () => {
    const { suggest } = await import('../src/lib/suggest');
    const pay = (id: string, max: number) => role(id, { nearMiss: 'pay', comp: { min: max - 20000, max, currency: 'USD' } });
    const matches = [pay('p1', 138000), pay('p2', 134000), pay('p3', 132500), role('o1', { nearMiss: 'age' }), role('o2', { nearMiss: 'age' }), role('o3', { nearMiss: 'age' })];
    const feedback = Object.fromEntries(matches.map((m) => [m.id, v('interested', m.title)]));
    const s = suggest({ criteria, feedback, matches, watches: [] });
    expect(s.map((x) => [x.id, x.text])).toEqual([
      ['pay:USD:130000', 'Lower your USD pay floor from $140K to $130K?'],
      ['age:60', 'Raise your age limit from 30 to 60 days?'],
    ]);
    expect(s[0].criteria!.comp_floor).toEqual({ USD: 130000 });
    expect(s[1].criteria!.max_age_days).toBe(60);
  });

  it('suggests dropping a company where you pass on everything, and an industry you keep passing on in Discover', async () => {
    const { suggest } = await import('../src/lib/suggest');
    const watches = [{ id: 7, name: 'Acme', ats: 'lever' as const, status: 'ok' as const }, { id: 8, name: 'Beta', ats: 'lever' as const, status: 'ok' as const }];
    const feedback: Record<string, ReturnType<typeof v>> = {
      a1: v('not_for_me', 'Senior Product Manager, Ads', 'Acme', 'ads'), a2: v('not_for_me', 'Senior Product Manager, Search', 'Acme'),
      a3: v('not_for_me', 'Staff Product Manager, Maps', 'Acme'), a4: v('not_for_me', 'Lead Product Manager, Mail', 'Acme'),
      b1: v('not_for_me', 'Senior Product Manager, Cards', 'Beta'), b2: v('interested', 'Staff Product Manager, Loans', 'Beta'),
      d1: v('not_for_me', 'Senior Product Manager, Assays', 'Genewave'), d2: v('not_for_me', 'Staff Product Manager, Trials', 'Helix'), d3: v('not_for_me', 'Lead Product Manager, Lab', 'Cellco'),
    };
    const bio = (id: string) => role(id, { via: ['Board A'], industries: ['Biotechnology', 'Health Care'] });
    const s = suggest({ criteria, feedback, matches: [bio('d1'), bio('d2'), bio('d3')], watches });
    expect(s.map((x) => x.id)).toEqual(['watch:7', 'industry:biotechnology']);
    expect(s[0]).toMatchObject({ text: 'Stop watching Acme?', removeWatch: { id: 7, name: 'Acme' } });
    expect(s[0].evidence[0]).toBe('Senior Product Manager, Ads (“ads”)');
    expect(s[1].criteria!.discover).toEqual({ skip_industries: ['biotechnology'] });
  });
});
