import { createHash } from "node:crypto";
import { parseWorkdayBoard, workdaySiteUrl, type WorkdayBoard } from "../../../shared/ats.js";
import type { BoardResult, Details, Posting } from "../types.js";
import { htmlToText, parseCompText } from "../normalize.js";
import { getJson, postJson } from "./http.js";

// Workday career sites (company.wd5.myworkdayjobs.com/Site) run on a JSON search API that the site's
// own page calls: POST .../wday/cxs/{tenant}/{site}/jobs for a page of results, GET .../{externalPath}
// for one job. Pages hold at most 20 jobs, newest first, and one search stops at 2,000 jobs.

interface WdListJob {
  // Normally always there, but Workday sometimes sends an entry without them.
  title?: string;
  externalPath?: string;
  /** One place, or just "3 Locations" when there are several. */
  locationsText?: string;
  /** "Posted Today", "Posted Yesterday", "Posted 3 Days Ago", "Posted 30+ Days Ago". */
  postedOn?: string;
  remoteType?: string;
}

interface WdFacet {
  facetParameter?: string;
  values?: { id?: string; count?: number }[];
}

interface WdList {
  /** Only filled in on the first page of a search, and never above 2,000. */
  total: number;
  jobPostings?: WdListJob[];
  facets?: WdFacet[];
}

interface WdJob {
  jobPostingInfo?: {
    location?: string;
    additionalLocations?: string[];
    country?: { descriptor?: string };
    jobDescription?: string;
    remoteType?: string;
  };
}

const PAGE_SIZE = 20; // Workday refuses more
const SEARCH_CAP = 2000;
/** Beyond this many pages a board is read only partly (and nothing on it is marked closed). */
const MAX_PAGES = 400;
const DAY = 86_400_000;

const api = (b: WorkdayBoard) => `https://${b.host}/wday/cxs/${b.tenant}/${b.site}`;

function boardOf(board: string): WorkdayBoard {
  const b = parseWorkdayBoard(board);
  if (!b) throw new Error("not a Workday board address");
  return b;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** "Posted 3 Days Ago" as a date. "30+ Days Ago" counts as 31, so a 30-day age limit leaves it out. */
export function postedOnToDate(text: string | undefined, now: Date): string | undefined {
  const t = (text ?? "").toLowerCase();
  let days: number | undefined;
  if (/today|just posted|hours? ago/.test(t)) days = 0;
  else if (/yesterday/.test(t)) days = 1;
  else {
    const m = t.match(/(\d+)(\+)?\s*days?/);
    if (m) days = Number(m[1]) + (m[2] ? 1 : 0);
  }
  return days === undefined ? undefined : new Date(now.getTime() - days * DAY).toISOString();
}

function workplaceOf(remoteType: string | undefined): Posting["workplace"] {
  const r = remoteType?.toLowerCase() ?? "";
  if (/remote/.test(r)) return "remote";
  if (/hybrid|flex/.test(r)) return "hybrid";
  if (/on-?site|office/.test(r)) return "onsite";
  return undefined;
}

/** The job's requisition number from its path (".../Senior-Engineer_JR2028908"), which survives title edits. */
const jobKey = (externalPath: string) => {
  const last = externalPath.split("/").pop() ?? externalPath;
  const i = last.lastIndexOf("_");
  return i >= 0 && i < last.length - 1 ? last.slice(i + 1) : last;
};

type Search = (facets: Record<string, string[]>, offset: number) => Promise<WdList>;

/** Every page of one search, given its first page. */
async function allPages(search: Search, facets: Record<string, string[]>, first: WdList, budget: { pages: number }) {
  const offsets: number[] = [];
  for (let o = PAGE_SIZE; o < Math.min(first.total, SEARCH_CAP); o += PAGE_SIZE) offsets.push(o);
  const allowed = offsets.slice(0, Math.max(0, budget.pages));
  budget.pages -= allowed.length;
  const rest = await mapLimit(allowed, 4, async (o) => (await search(facets, o)).jobPostings ?? []);
  return { jobs: [...(first.jobPostings ?? []), ...rest.flat()], cut: allowed.length < offsets.length };
}

/**
 * The facet (job category, say) that splits a big board into searches of under 2,000 each while
 * still covering every job, with as few searches as possible.
 */
function splitFacet(facets: WdFacet[] | undefined) {
  const usable = (facets ?? [])
    .map((f) => ({ param: f.facetParameter, values: (f.values ?? []).filter((v) => v.id && typeof v.count === "number") }))
    .filter((f) => f.param && f.values.length)
    .map((f) => ({ param: f.param!, values: f.values as { id: string; count: number }[], sum: f.values.reduce((s, v) => s + v.count!, 0) }));
  if (!usable.length) return undefined;
  const everything = Math.max(...usable.map((f) => f.sum));
  const fits = usable.filter((f) => f.values.every((v) => v.count < SEARCH_CAP)).sort((a, b) => b.sum - a.sum || a.values.length - b.values.length);
  const best = fits[0];
  return best ? { ...best, complete: best.sum >= everything } : undefined;
}

/** Every job on the board, and whether some may be missing (then nothing should be marked closed). */
export async function listWorkday(board: WorkdayBoard): Promise<{ jobs: WdListJob[]; partial: boolean }> {
  const search: Search = (appliedFacets, offset) =>
    postJson<WdList>(`${api(board)}/jobs`, { appliedFacets, limit: PAGE_SIZE, offset, searchText: "" });
  const budget = { pages: MAX_PAGES };
  const first = await search({}, 0);
  if (first.total < SEARCH_CAP) {
    const r = await allPages(search, {}, first, budget);
    return { jobs: r.jobs, partial: r.cut };
  }
  const facet = splitFacet(first.facets);
  if (!facet) {
    const r = await allPages(search, {}, first, budget);
    return { jobs: r.jobs, partial: true };
  }
  let partial = !facet.complete;
  const jobs: WdListJob[] = [];
  for (const v of facet.values) {
    if (budget.pages <= 0) {
      partial = true;
      break;
    }
    const f = { [facet.param]: [v.id] };
    const head = await search(f, 0);
    budget.pages--;
    if (head.total >= SEARCH_CAP) partial = true;
    const r = await allPages(search, f, head, budget);
    if (r.cut) partial = true;
    jobs.push(...r.jobs);
  }
  return { jobs, partial };
}

export async function fetchWorkday(board: string, company: string, etag?: string, now = new Date()): Promise<BoardResult> {
  const b = boardOf(board);
  const listed = await listWorkday(b);
  const { jobs } = listed;
  let { partial } = listed;
  const site = workdaySiteUrl(b);
  const byId = new Map<string, Posting>();
  let skipped = false;
  for (const j of jobs) {
    // An entry with no link or title can't be shown or followed. Skip it rather than fail the whole
    // board, and count the read as partial so nothing is marked closed because of it.
    if (!j.externalPath?.trim() || !j.title?.trim()) {
      skipped = true;
      continue;
    }
    const key = jobKey(j.externalPath);
    const id = `workday:${board}:${key}`;
    if (byId.has(id)) continue; // a job can show up under two categories
    const text = j.locationsText?.trim() ?? "";
    const several = /^\d+\s+locations?$/i.test(text);
    byId.set(id, {
      id,
      source: "workday",
      companyKey: `workday:${board}`,
      company,
      title: j.title.trim(),
      // With several places the list only gives a count; the job's own page has them (fetched when
      // its title fits someone, like pay).
      locations: several ? [text.toLowerCase()] : text ? [text] : [],
      workplace: workplaceOf(j.remoteType),
      url: `${site}${j.externalPath}`,
      atsPostedAt: postedOnToDate(j.postedOn, now),
      compChecked: false,
      locationsFromDetails: true,
    });
  }
  const postings = [...byId.values()];
  partial ||= skipped;
  // Workday sends no version tag, so make one from what we keep. "Posted N days ago" changes daily
  // by itself, so it's left out.
  const tag =
    "wd1:" +
    createHash("sha1")
      .update(postings.map((p) => `${p.id}|${p.title}|${p.locations.join(";")}|${p.workplace ?? ""}`).sort().join("\n"))
      .digest("hex") +
    (partial ? ":partial" : "");
  if (etag === tag) return { unchanged: true };
  return { postings, etag: tag, partial };
}

/** One job's own page: every place it's in, and its pay range when the description gives one. */
export async function workdayDetails(board: string, p: Posting): Promise<Details> {
  const b = boardOf(board);
  const site = workdaySiteUrl(b);
  if (!p.url.startsWith(`${site}/`)) throw new Error("posting address doesn't match its board");
  const info = (await getJson<WdJob>(`${api(b)}${p.url.slice(site.length)}`)).jobPostingInfo ?? {};
  const country = info.country?.descriptor?.trim();
  const main = info.location?.trim();
  const locations = [
    main && country && !main.toLowerCase().includes(country.toLowerCase()) ? `${main}, ${country}` : main,
    ...(info.additionalLocations ?? []).map((l) => l.trim()),
  ].filter((l): l is string => !!l);
  return {
    comp: info.jobDescription ? parseCompText(htmlToText(info.jobDescription)) : undefined,
    locations: locations.length ? locations : undefined,
    workplace: workplaceOf(info.remoteType) ?? p.workplace,
  };
}
