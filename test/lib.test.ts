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

  it("takes a Workday link as given, since the page can't read Workday", async () => {
    const fake = (async () => { throw new Error('should not fetch'); }) as unknown as typeof fetch;
    expect(await findBoards('https://acme.wd1.myworkdayjobs.com/External/job/x_R1', fake)).toEqual([
      { ats: 'workday', board: 'acme.wd1.myworkdayjobs.com/acme/External', sample: [] },
    ]);
  });
});
