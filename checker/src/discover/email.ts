import { createHash } from "node:crypto";
import { parseBoardUrl } from "../../../shared/ats.js";
import { safeHttpUrl } from "../../../shared/url.js";
import type { DiscoverJob } from "./types.js";

// Jobs from job-alert emails (LinkedIn, Indeed, Wellfound, VC boards...), read without AI: each job
// in such an email is a link to the job whose text is its title, followed by a line or two with the
// company and place ("Acme · New York, NY"). Free-form newsletters aren't read (that needs AI).

export interface InboundEmail {
  id: number;
  profile_id: string;
  from_name: string | null;
  from_address: string | null;
  subject: string | null;
  html: string | null;
  text_body: string | null;
  received_at: string;
}

/** Links that are a single job, on the sites that send job alerts or host job boards. */
const JOB_LINK: RegExp[] = [
  /linkedin\.com\/(comm\/)?jobs\/view\/\d+/i,
  /indeed\.[a-z.]+\/(viewjob|rc\/clk|pagead\/clk|m\/viewjob)\b/i,
  /(wellfound\.com|angel\.co)\/(jobs|company\/[^/]+\/jobs)\/\d+/i,
  /\/companies\/[^/?#]+\/jobs\/[^/?#]+/i, // Consider and Getro VC boards
  /glassdoor\.[a-z.]+\/(job-listing|partner\/jobListing)/i,
  /ziprecruiter\.com\/(c|jobs|k)\//i,
];

/** Link text that isn't a job title. */
const NOT_A_TITLE = /^(view|see|apply|show|more|search|browse|manage|unsubscribe|settings|edit|get|open|learn|easy apply|save|share|privacy|help|jobs? (for|like|you)|new jobs?|all jobs?)\b/i;

export function isJobLink(href: string): boolean {
  // Emails can come from anyone, so only ordinary web links count (never "javascript:" and the like).
  if (!safeHttpUrl(href)) return false;
  return JOB_LINK.some((r) => r.test(href)) || !!parseBoardUrl(href)?.board && /\/(jobs?|j|o)\/|gh_jid=|\/[0-9a-f-]{20,}/i.test(href);
}

/** Where the alert came from, for "via LinkedIn alert". */
export function sourceLabel(e: Pick<InboundEmail, "from_name" | "from_address">): string {
  const addr = (e.from_address ?? "").toLowerCase();
  if (addr.includes("linkedin")) return "LinkedIn alert";
  if (addr.includes("indeed")) return "Indeed alert";
  if (addr.includes("wellfound") || addr.includes("angel.co")) return "Wellfound alert";
  if (addr.includes("glassdoor")) return "Glassdoor alert";
  const name = (e.from_name ?? "").replace(/["']/g, "").trim();
  return name ? `${name} alert` : `${addr.split("@")[1] ?? "Email"} alert`;
}

const decode = (s: string) =>
  s
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&rsquo;/gi, "'")
    .replace(/&middot;|&#183;/gi, "·")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

/** The same job from two alerts should be one job: drop tracking bits from its link. */
export function cleanJobUrl(href: string): string {
  try {
    const u = new URL(href);
    const li = u.pathname.match(/\/jobs\/view\/(\d+)/);
    if (u.hostname.includes("linkedin.") && li) return `https://www.linkedin.com/jobs/view/${li[1]}/`;
    const jk = u.searchParams.get("jk");
    if (u.hostname.includes("indeed.") && jk) return `https://www.indeed.com/viewjob?jk=${jk}`;
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref|trk|tracking|refId|trackingId|lipi|midToken|midSig|eid|otpToken|ssid|fccid|cmp|t$)/i.test(k)) u.searchParams.delete(k);
    u.hash = "";
    return u.toString();
  } catch {
    return href;
  }
}

/**
 * Lines of text, with each link marked as \u0001index\u0002text\u0003 so a link's text and the lines
 * after it can be read together.
 */
function lines(html: string): { lines: string[]; hrefs: string[] } {
  const hrefs: string[] = [];
  const marked = html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<a\b[^>]*?href\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi, (_m, _q, h1, h2, inner) => {
      hrefs.push(decode(h1 ?? h2 ?? ""));
      const text = inner.replace(/<[^>]+>/g, " ");
      return `\u0001${hrefs.length - 1}\u0002${text}\u0003`;
    })
    .replace(/<br\s*\/?>|<\/(p|div|tr|td|li|h[1-6]|table|span)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return {
    hrefs,
    lines: decode(marked)
      .split("\n")
      .map((l) => l.replace(/[ \t\r]+/g, " ").trim())
      .filter(Boolean),
  };
}

const LINK = /\u0001(\d+)\u0002([^\u0003]*)\u0003/g;
const plain = (line: string) => line.replace(LINK, (_m, _i, t) => t).replace(/\s+/g, " ").trim();
const SEP = /\s*(?:·|•|\||–| - )\s*/;

/** Jobs in one email. Only links to a single job count; each needs a title-like link text. */
export function jobsFromEmail(e: InboundEmail): DiscoverJob[] {
  const label = sourceLabel(e);
  const { lines: ls, hrefs } = lines(e.html || (e.text_body ?? "").replace(/(https?:\/\/\S+)/g, '<a href="$1">$1</a>').replace(/\n/g, "<br>"));
  const found = new Map<string, DiscoverJob>();
  ls.forEach((line, i) => {
    for (const m of line.matchAll(LINK)) {
      const href = hrefs[Number(m[1])];
      const title = m[2].replace(/\s+/g, " ").trim();
      if (!href || !isJobLink(href) || title.length < 4 || title.length > 140 || NOT_A_TITLE.test(title) || /^https?:/i.test(title)) continue;
      // The company and place follow the title, on the same line or the next ones (until the next job).
      const rest = plain(line.replace(m[0], "")).replace(/^[·•|–-]\s*/, "");
      const after: string[] = rest ? [rest] : [];
      for (let j = i + 1; j < ls.length && after.length < 3; j++) {
        const next = ls[j];
        const links = [...next.matchAll(LINK)].map((x) => hrefs[Number(x[1])]);
        if (links.some((h) => h && isJobLink(h))) break;
        // A line that's only "See all jobs" / "Manage alerts" style links: the email's footer.
        const texts = [...next.matchAll(LINK)].map((x) => x[2].trim());
        if (texts.length && !plain(next.replace(LINK, "")) && texts.every((t) => NOT_A_TITLE.test(t))) break;
        const p = plain(next);
        if (p && p.length <= 120) after.push(p);
      }
      const parts = after.flatMap((a) => a.split(SEP)).map((s) => s.trim()).filter(Boolean);
      const url = cleanJobUrl(href);
      const board = parseBoardUrl(url);
      const company = parts[0] && !/^(new|actively|promoted|posted|\d+ (applicants|days?|hours?))/i.test(parts[0]) ? parts[0] : board?.board ?? "Unknown company";
      const id = `e:${createHash("sha1").update(`${e.profile_id}|${url}`).digest("hex").slice(0, 16)}`;
      if (found.has(id)) continue;
      found.set(id, {
        id,
        company,
        title,
        // Everything after the company is a candidate place; the filters look for your places in it.
        locations: parts.slice(1, 4),
        workplace: parts.some((p) => /\bremote\b/i.test(p)) ? "remote" : parts.some((p) => /\bhybrid\b/i.test(p)) ? "hybrid" : undefined,
        url,
        postedAt: e.received_at,
        ats: board?.ats,
        board: board?.board,
        via: [label],
        forProfile: e.profile_id,
      });
    }
  });
  return [...found.values()];
}
