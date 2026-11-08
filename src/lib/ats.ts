import type { Ats } from '../../shared/ats';
import { companyFromSiteUrl, GUESSABLE_ATS, jobIdFromUrl, parseBoardUrl, slugCandidates } from '../../shared/ats';

export { ATS_LABEL, boardLabel, boardUrl, companyFromSiteUrl, looksLikeUrl, parseBoardUrl, slugCandidates } from '../../shared/ats';

// Greenhouse, Lever, and Ashby all allow browser requests to their public job-board APIs,
// so the page can find a company's board without a server. Workday doesn't, so a Workday link is
// taken as given and the checker reads it as soon as it's added.

export interface BoardHit {
  ats: Ats;
  board: string;
  /** Open roles; unknown for a Workday link, which the page can't read. */
  jobs?: number;
  /** A few titles, so a person can tell it's the right company. */
  sample: string[];
  /** The company's name as the board reports it, when it does. */
  displayName?: string;
  /** The pasted link's own job is on this board, so it's surely theirs. */
  hasJob?: boolean;
}

async function getJson(url: string, fetchImpl: typeof fetch): Promise<any | undefined> {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
    return res.ok ? await res.json() : undefined;
  } catch {
    return undefined;
  }
}

export async function probeBoard(ats: Ats, board: string, fetchImpl: typeof fetch = fetch.bind(globalThis), jobId?: string): Promise<BoardHit | undefined> {
  const b = encodeURIComponent(board);
  if (ats === 'workday') return undefined;
  if (ats === 'greenhouse') {
    const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${b}/jobs`, fetchImpl);
    if (!d?.jobs) return undefined;
    const hasJob = jobId ? d.jobs.some((j: any) => String(j.id) === jobId) : undefined;
    return { ats, board, jobs: d.jobs.length, sample: d.jobs.slice(0, 3).map((j: any) => j.title), displayName: d.jobs[0]?.company_name, hasJob };
  }
  if (ats === 'lever') {
    const d = await getJson(`https://api.lever.co/v0/postings/${b}?mode=json`, fetchImpl);
    if (!Array.isArray(d)) return undefined;
    return { ats, board, jobs: d.length, sample: d.slice(0, 3).map((j: any) => j.text) };
  }
  const d = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${b}`, fetchImpl);
  if (!d?.jobs) return undefined;
  const listed = d.jobs.filter((j: any) => j.isListed !== false);
  const hasJob = jobId ? listed.some((j: any) => j.id === jobId) : undefined;
  return { ats, board, jobs: listed.length, sample: listed.slice(0, 3).map((j: any) => j.title), hasJob };
}

/**
 * Find a company's board from a name (tries likely slugs everywhere) or a pasted link: a job-board
 * link names its board; a link to the company's own careers site gives the company's name to try.
 */
export async function findBoards(input: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<BoardHit[]> {
  const fromUrl = parseBoardUrl(input);
  if (fromUrl?.ats === 'workday') return [{ ...fromUrl, sample: [] }];
  const name = fromUrl ? undefined : companyFromSiteUrl(input) ?? input;
  const job = fromUrl ? undefined : jobIdFromUrl(input);
  const tries = fromUrl ? [fromUrl] : slugCandidates(name!).flatMap((board) => GUESSABLE_ATS.map((ats) => ({ ats, board })));
  const hits = await Promise.all(tries.map((t) => probeBoard(t.ats, t.board, fetchImpl, job?.ats === t.ats ? job.id : undefined)));
  // The board with the link's own job first; then the busiest, since an empty board under a guessed
  // slug is usually a stale or unrelated one.
  return hits
    .filter((h): h is BoardHit => !!h)
    .sort((a, b) => Number(!!b.hasJob) - Number(!!a.hasJob) || (b.jobs ?? 0) - (a.jobs ?? 0));
}
