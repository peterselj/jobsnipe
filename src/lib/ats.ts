import type { Ats } from './types';

// Greenhouse, Lever, and Ashby all allow browser requests to their public job-board APIs,
// so the page can find a company's board without a server. Same logic as the backend's
// `npm run detect`.

export function boardUrl(ats: Ats, board: string): string {
  switch (ats) {
    case 'greenhouse':
      return `https://job-boards.greenhouse.io/${board}`;
    case 'lever':
      return `https://jobs.lever.co/${board}`;
    case 'ashby':
      return `https://jobs.ashbyhq.com/${board}`;
  }
}

export const ATS_LABEL: Record<Ats, string> = { greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby' };

/** Recognize a pasted job-board or job-posting link. */
export function parseBoardUrl(input: string): { ats: Ats; board: string } | undefined {
  let url: URL;
  try {
    url = new URL(input.includes('://') ? input.trim() : `https://${input.trim()}`);
  } catch {
    return undefined;
  }
  const parts = url.pathname.split('/').filter(Boolean);
  const host = url.hostname.toLowerCase();
  if (host.endsWith('greenhouse.io')) {
    const board = parts[0] === 'v1' && parts[1] === 'boards' ? parts[2] : parts[0];
    const token = board === 'embed' ? url.searchParams.get('for') : board;
    return token ? { ats: 'greenhouse', board: token } : undefined;
  }
  if (host === 'jobs.lever.co' || host === 'api.lever.co') {
    const board = host === 'api.lever.co' ? parts[2] : parts[0];
    return board ? { ats: 'lever', board } : undefined;
  }
  if (host === 'jobs.ashbyhq.com') return parts[0] ? { ats: 'ashby', board: parts[0] } : undefined;
  if (host === 'api.ashbyhq.com' && parts[0] === 'posting-api') {
    return parts[2] ? { ats: 'ashby', board: parts[2] } : undefined;
  }
  return undefined;
}

export const looksLikeUrl = (s: string) => /^(https?:\/\/)?[\w-]+(\.[\w-]+)+\//i.test(s.trim());

/** Board slugs worth trying for a name: "Acme Robotics Group" -> acmeroboticsgroup, acme-robotics-group, arg, ... */
export function slugCandidates(name: string): string[] {
  const words = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, '')
    .split(/\s+/)
    .filter((w) => w && !['inc', 'llc', 'ltd', 'corp', 'co'].includes(w));
  const noThe = words[0] === 'the' ? words.slice(1) : words;
  const bases = new Set<string>();
  for (const w of [words, noThe]) {
    if (!w.length) continue;
    bases.add(w.join(''));
    bases.add(w.join('-'));
  }
  const out = new Set<string>(bases);
  for (const b of bases) for (const suffix of ['inc', 'ai', 'hq', 'jobs', 'careers']) out.add(b + suffix);
  if (noThe.length > 1) out.add(noThe.map((w) => w[0]).join(''));
  return [...out];
}

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
