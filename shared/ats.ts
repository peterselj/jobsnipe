// Job-board helpers shared by the page (src/) and the checker (checker/).

export type Ats = 'greenhouse' | 'lever' | 'ashby';

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

