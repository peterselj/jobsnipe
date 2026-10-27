import type { Ats } from '../../shared/ats';
import { parseBoardUrl, slugCandidates } from '../../shared/ats';

export { ATS_LABEL, boardUrl, looksLikeUrl, parseBoardUrl, slugCandidates } from '../../shared/ats';

// Greenhouse, Lever, and Ashby all allow browser requests to their public job-board APIs,
// so the page can find a company's board without a server.

export interface BoardHit {
  ats: Ats;
  board: string;
  jobs: number;
  /** A few titles, so a person can tell it's the right company. */
  sample: string[];
  /** The company's name as the board reports it, when it does. */
  displayName?: string;
}

async function getJson(url: string, fetchImpl: typeof fetch): Promise<any | undefined> {
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
    return res.ok ? await res.json() : undefined;
  } catch {
    return undefined;
  }
}

export async function probeBoard(ats: Ats, board: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<BoardHit | undefined> {
  const b = encodeURIComponent(board);
  if (ats === 'greenhouse') {
    const d = await getJson(`https://boards-api.greenhouse.io/v1/boards/${b}/jobs`, fetchImpl);
    if (!d?.jobs) return undefined;
    return { ats, board, jobs: d.jobs.length, sample: d.jobs.slice(0, 3).map((j: any) => j.title), displayName: d.jobs[0]?.company_name };
  }
  if (ats === 'lever') {
    const d = await getJson(`https://api.lever.co/v0/postings/${b}?mode=json`, fetchImpl);
    if (!Array.isArray(d)) return undefined;
    return { ats, board, jobs: d.length, sample: d.slice(0, 3).map((j: any) => j.text) };
  }
  const d = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${b}`, fetchImpl);
  if (!d?.jobs) return undefined;
  const listed = d.jobs.filter((j: any) => j.isListed !== false);
  return { ats, board, jobs: listed.length, sample: listed.slice(0, 3).map((j: any) => j.title) };
}

/** Find a company's board from a name (tries likely slugs everywhere) or a pasted job link. */
export async function findBoards(input: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<BoardHit[]> {
  const fromUrl = parseBoardUrl(input);
  const tries = fromUrl
    ? [fromUrl]
    : slugCandidates(input).flatMap((board) => (['greenhouse', 'lever', 'ashby'] as Ats[]).map((ats) => ({ ats, board })));
  const hits = await Promise.all(tries.map((t) => probeBoard(t.ats, t.board, fetchImpl)));
  // Busiest board first: an empty board under a guessed slug is usually a stale or unrelated one.
  return hits.filter((h): h is BoardHit => !!h).sort((a, b) => b.jobs - a.jobs);
}
