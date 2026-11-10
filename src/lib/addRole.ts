import { linkOwner, parseBoardUrl } from '../../shared/ats';
import { safeHttpUrl } from '../../shared/url';

// Adding a role by hand: any job you found yourself (LinkedIn, a referral, a company's own site) goes
// straight to Interested. Nothing is fetched from the site it's on; you bring the link and its title,
// by pasting them or with the "Save to JobSnipe" bookmark.

export interface RoleDraft {
  url: string;
  title: string;
  company: string;
}

const pretty = (slug: string) => slug.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/** Tracking bits removed, so the same job saved twice is one role. */
export function cleanRoleUrl(url: string): string | undefined {
  const safe = safeHttpUrl(url);
  if (!safe) return undefined;
  const u = new URL(safe);
  const li = u.hostname.endsWith('linkedin.com') ? u.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/) ?? u.search.match(/currentJobId=(\d+)/) : null;
  if (li) return `https://www.linkedin.com/jobs/view/${li[1]}/`;
  for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref|trk|tracking|refId|trackingId|lipi|src|source$)/i.test(k)) u.searchParams.delete(k);
  u.hash = '';
  return u.toString();
}

/**
 * A job page's browser-tab title as a role. Sites word them differently:
 * "Senior PM | Acme | LinkedIn", "Acme hiring Senior PM in New York, NY | LinkedIn",
 * "Job Application for Senior PM at Acme", "Senior PM @ Acme", "Acme - Senior PM",
 * "Senior PM - Acme - New York, NY - Indeed.com".
 */
export function roleFromPage(url: string, pageTitle = ''): RoleDraft {
  const t = pageTitle.replace(/^\(\d+\)\s*/, '').replace(/\s+/g, ' ').trim();
  const fallback = () => {
    const owner = linkOwner(url);
    return owner && !['linkedin', 'indeed', 'wellfound', 'glassdoor'].includes(owner) ? pretty(owner) : '';
  };
  const done = (title: string, company: string): RoleDraft => ({ url: cleanRoleUrl(url) ?? url, title: title.trim(), company: (company || fallback()).trim() });
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(.+?) hiring (.+?) in .+? \| LinkedIn$/i))) return done(m[2], m[1]);
  if ((m = t.match(/^(.+?) \| (.+?) \| LinkedIn$/i))) return done(m[1], m[2]);
  if ((m = t.match(/^Job Application for (.+) at (.+)$/i))) return done(m[1], m[2]);
  if ((m = t.match(/^(.+?) - (.+?) - .+ - Indeed(\.com)?$/i))) return done(m[1], m[2]);
  if ((m = t.match(/^(.+?) @ (.+)$/))) return done(m[1], m[2]);
  // "Acme - Senior PM" (Lever): the board's own name tells us which side is the company.
  const owner = parseBoardUrl(url)?.board.toLowerCase();
  if (owner && (m = t.match(/^(.+?) - (.+)$/)) && m[1].toLowerCase().replace(/[^a-z0-9]/g, '') === owner.replace(/[^a-z0-9]/g, '')) return done(m[2], m[1]);
  return done(t.replace(/\s*[|–-]\s*(LinkedIn|Indeed(\.com)?|Glassdoor|Wellfound)\s*$/i, ''), '');
}

/** A steady id for a hand-added role, from its link, so saving it twice updates the one role. */
export function manualId(url: string): string {
  let h = 0x811c9dc5;
  const key = cleanRoleUrl(url) ?? url;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return `manual:${(h >>> 0).toString(16).padStart(8, '0')}${key.length.toString(16)}`;
}

export const isManual = (id: string) => id.startsWith('manual:');

/**
 * For links to Greenhouse and Lever jobs, the board's public API gives the title and company, so
 * they fill in by themselves. Other sites (LinkedIn among them) aren't asked anything.
 */
export async function lookUpRole(url: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<Partial<RoleDraft> | undefined> {
  const board = parseBoardUrl(url);
  const u = new URL(safeHttpUrl(url) ?? 'https://invalid.example');
  const id = u.searchParams.get('gh_jid') ?? u.pathname.match(/\/jobs\/(\d+)/)?.[1] ?? u.pathname.match(/\/([0-9a-f]{8}-[0-9a-f-]{27})/i)?.[1];
  if (!board || !id) return undefined;
  const get = async (api: string) => {
    try {
      const res = await fetchImpl(api, { signal: AbortSignal.timeout(10_000) });
      return res.ok ? await res.json() : undefined;
    } catch {
      return undefined;
    }
  };
  const b = encodeURIComponent(board.board);
  if (board.ats === 'greenhouse') {
    const j = await get(`https://boards-api.greenhouse.io/v1/boards/${b}/jobs/${encodeURIComponent(id)}`);
    return j?.title ? { title: j.title, company: j.company_name ?? pretty(board.board) } : undefined;
  }
  if (board.ats === 'lever') {
    const j = await get(`https://api.lever.co/v0/postings/${b}/${encodeURIComponent(id)}`);
    return j?.text ? { title: j.text, company: pretty(board.board) } : undefined;
  }
  return undefined;
}

const SITE = 'https://peterselj.github.io/jobsnipe/';

/**
 * The "Save to JobSnipe" bookmark: on any job page, it opens JobSnipe with that page's address and
 * tab title filled in. It sends nothing anywhere else and reads nothing but those two things.
 */
export const BOOKMARKLET = `javascript:(function(){window.open('${SITE}?add='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title))})()`;

const PENDING = 'jobsnipe.pendingAdd';

/** Remember a role arriving in the address (?add=…&title=…) across sign-in, and tidy the address. */
export function capturePendingAdd(loc: Location = location, store: Storage = localStorage): void {
  const q = new URLSearchParams(loc.search);
  const url = cleanRoleUrl(q.get('add') ?? '');
  if (!q.has('add')) return;
  if (url) store.setItem(PENDING, JSON.stringify({ url, title: (q.get('title') ?? '').slice(0, 300), at: Date.now() }));
  q.delete('add');
  q.delete('title');
  history.replaceState(null, '', loc.pathname + (q.toString() ? `?${q}` : ''));
}

export function takePendingAdd(store: Storage = localStorage): RoleDraft | undefined {
  try {
    const raw = store.getItem(PENDING);
    store.removeItem(PENDING);
    const p = raw ? JSON.parse(raw) : undefined;
    // An hour is plenty to click the sign-in link; older ones are stale.
    return p?.url && Date.now() - p.at < 3_600_000 ? roleFromPage(p.url, p.title) : undefined;
  } catch {
    return undefined;
  }
}
