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
