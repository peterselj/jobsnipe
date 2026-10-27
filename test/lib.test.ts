import { describe, expect, it } from 'vitest';
import { findBoards, parseBoardUrl, slugCandidates } from '../src/lib/ats';

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
