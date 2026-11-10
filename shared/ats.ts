// Job-board helpers shared by the page (src/) and the checker (checker/).

export type Ats = 'greenhouse' | 'lever' | 'ashby' | 'workday' | 'smartrecruiters' | 'recruitee';

/**
 * A SmartRecruiters board is the company's identifier as it appears in its job links
 * (jobs.smartrecruiters.com/AcmeInc/...).
 */
export const SMARTRECRUITERS_BOARD = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;

/**
 * A Recruitee board is the first part of the company's Recruitee address (acme.recruitee.com). The
 * checker fetches from that host, so only a plain name is ever accepted.
 */
export const RECRUITEE_BOARD = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * A Workday board is stored as "host/tenant/site", e.g.
 * "nvidia.wd5.myworkdayjobs.com/nvidia/NVIDIAExternalCareerSite": unlike the other boards it can't
 * be found from a company name, only from one of its links.
 */
export interface WorkdayBoard {
  host: string;
  tenant: string;
  site: string;
}

const WORKDAY_JOBS_HOST = /^[a-z0-9-]+(\.wd\d{1,3})?\.myworkdayjobs\.com$/;
const WORKDAY_SITE_HOST = /^wd\d{1,3}\.myworkdaysite\.com$/;
const WORKDAY_NAME = /^[A-Za-z0-9_.-]+$/;

/** Only real Workday hosts, so a stored board can never point the checker anywhere else. */
export function parseWorkdayBoard(board: string): WorkdayBoard | undefined {
  const [host, tenant, site, ...rest] = board.split('/');
  if (rest.length || !host || !tenant || !site) return undefined;
  if (!WORKDAY_JOBS_HOST.test(host) && !WORKDAY_SITE_HOST.test(host)) return undefined;
  if (!WORKDAY_NAME.test(tenant) || !WORKDAY_NAME.test(site)) return undefined;
  return { host, tenant, site };
}

/** Where Workday's own job-search page for a board lives. */
export function workdaySiteUrl(b: WorkdayBoard): string {
  return WORKDAY_SITE_HOST.test(b.host) ? `https://${b.host}/recruiting/${b.tenant}/${b.site}` : `https://${b.host}/${b.site}`;
}

export function boardUrl(ats: Ats, board: string): string {
  switch (ats) {
    case 'greenhouse':
      return `https://job-boards.greenhouse.io/${board}`;
    case 'lever':
      return `https://jobs.lever.co/${board}`;
    case 'ashby':
      return `https://jobs.ashbyhq.com/${board}`;
    case 'workday': {
      const b = parseWorkdayBoard(board);
      return b ? workdaySiteUrl(b) : `https://${board.split('/')[0]}`;
    }
    case 'smartrecruiters':
      return `https://jobs.smartrecruiters.com/${encodeURIComponent(board)}`;
    case 'recruitee':
      return RECRUITEE_BOARD.test(board) ? `https://${board}.recruitee.com` : 'https://recruitee.com';
  }
}

/** A board's name for showing to people (Workday's stored form is long). */
export function boardLabel(ats: Ats, board: string): string {
  if (ats !== 'workday') return board;
  const b = parseWorkdayBoard(board);
  return b ? `${b.tenant} / ${b.site}` : board;
}

export const ATS_LABEL: Record<Ats, string> = {
  greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', workday: 'Workday', smartrecruiters: 'SmartRecruiters', recruitee: 'Recruitee',
};

/** The boards a company name can be looked up on (the others need one of the company's job links). */
export const GUESSABLE_ATS: Ats[] = ['greenhouse', 'lever', 'ashby'];

function toUrl(input: string): URL | undefined {
  const s = input.trim();
  if (!s.includes('://') && !/^[\w-]+(\.[\w-]+)+(\/|$)/.test(s)) return undefined;
  try {
    return new URL(s.includes('://') ? s : `https://${s}`);
  } catch {
    return undefined;
  }
}

/** Recognize a pasted job-board or job-posting link. */
export function parseBoardUrl(input: string): { ats: Ats; board: string } | undefined {
  const url = toUrl(input);
  if (!url) return undefined;
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
  // jobs.smartrecruiters.com/AcmeInc/744000…-senior-pm, careers.smartrecruiters.com/AcmeInc,
  // api.smartrecruiters.com/v1/companies/AcmeInc/postings
  if (host === 'jobs.smartrecruiters.com' || host === 'careers.smartrecruiters.com' || host === 'api.smartrecruiters.com') {
    const board = host === 'api.smartrecruiters.com' ? (parts[1] === 'companies' ? parts[2] : undefined) : parts[0];
    return board && SMARTRECRUITERS_BOARD.test(board) ? { ats: 'smartrecruiters', board } : undefined;
  }
  // acme.recruitee.com/o/senior-pm (a company's own careers address in front of it can't be told apart)
  if (host.endsWith('.recruitee.com')) {
    const board = host.slice(0, -'.recruitee.com'.length);
    return RECRUITEE_BOARD.test(board) && !['www', 'api', 'app', 'careers', 'help', 'support'].includes(board) ? { ats: 'recruitee', board } : undefined;
  }
  return parseWorkdayUrl(host, parts);
}

// Workday links put a language first sometimes: /en-US/NVIDIAExternalCareerSite/job/...
const LOCALE = /^[a-z]{2}(-[a-z]{2})?$/i;

function parseWorkdayUrl(host: string, parts: string[]): { ats: Ats; board: string } | undefined {
  let tenant: string | undefined;
  let site: string | undefined;
  if (parts[0] === 'wday' && parts[1] === 'cxs') {
    [tenant, site] = [parts[2], parts[3]];
  } else {
    const rest = LOCALE.test(parts[0] ?? '') ? parts.slice(1) : parts;
    if (WORKDAY_JOBS_HOST.test(host)) [tenant, site] = [host.split('.')[0], rest[0]];
    else if (WORKDAY_SITE_HOST.test(host) && rest[0] === 'recruiting') [tenant, site] = [rest[1], rest[2]];
  }
  if (!tenant || !site) return undefined;
  const board = `${host}/${tenant}/${site}`;
  return parseWorkdayBoard(board) ? { ats: 'workday', board } : undefined;
}

/**
 * A company's own careers site often sits in front of one of these boards (DoorDash's is Greenhouse,
 * under "doordashusa"). Its address still names the company: careers.doordash.com and
 * careersatdoordash.com both give "doordash".
 */
export function companyFromSiteUrl(input: string): string | undefined {
  const url = toUrl(input);
  if (!url) return undefined;
  const labels = url.hostname.toLowerCase().replace(/^www\./, '').split('.');
  if (labels.length < 2) return undefined;
  let i = labels.length - 2;
  // acme.co.uk, acme.com.au
  if (i > 0 && /^(co|com|org|net|ac)$/.test(labels[i]) && labels[labels.length - 1].length === 2) i--;
  const name = labels[i]
    .replace(/^(careers?|jobs?|work|join)(at|with)(?=[a-z0-9]{3})|^(careers|jobs)-?(?=[a-z0-9]{3})/, '')
    .replace(/-?(careers?|jobs)$/, '');
  return name.length >= 2 ? name : undefined;
}

/** The job a careers-site link points at, when it says (?gh_jid=123 is Greenhouse's, ?ashby_jid= Ashby's). */
export function jobIdFromUrl(input: string): { ats: Ats; id: string } | undefined {
  const url = toUrl(input);
  const gh = url?.searchParams.get('gh_jid');
  if (gh) return { ats: 'greenhouse', id: gh };
  const ashby = url?.searchParams.get('ashby_jid');
  return ashby ? { ats: 'ashby', id: ashby } : undefined;
}

export const looksLikeUrl = (s: string) => toUrl(s) !== undefined;

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
  for (const b of bases) for (const suffix of ['inc', 'ai', 'hq', 'jobs', 'careers', 'usa', 'us']) out.add(b + suffix);
  if (noThe.length > 1) out.add(noThe.map((w) => w[0]).join(''));
  return [...out];
}


/**
 * Who a job link really belongs to, as a short name: the board name on Greenhouse, Lever and Ashby,
 * the company on a Workday site, otherwise the site's own name ("careers.salesforce.com" → salesforce).
 * VC boards sometimes file a job under the wrong company (e.g. one a bigger company bought).
 */
export function linkOwner(url: string): string | undefined {
  const b = parseBoardUrl(url);
  if (b) return b.ats === 'workday' ? b.board.split('.')[0] : b.board;
  try {
    const labels = new URL(url).hostname.toLowerCase().replace(/^www\./, '').split('.');
    return labels.length >= 2 ? labels[labels.length - 2] : labels[0];
  } catch {
    return undefined;
  }
}
