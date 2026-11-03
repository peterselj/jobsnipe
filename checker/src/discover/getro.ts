import { parseBoardUrl } from "../../../shared/ats.js";
import { HttpError } from "../ats/http.js";
import { discoverId, type DiscoverJob } from "./types.js";

// Getro runs many VC portfolio job boards (General Catalyst, Accel, Khosla, Thrive, Lux...). Each
// board is a "collection" on Getro, searched the way the board's own page does.

interface GetroJob {
  id: number;
  title: string;
  url: string;
  locations?: string[];
  work_mode?: string;
  created_at?: number; // seconds
  compensation_amount_min_cents?: number | null;
  compensation_amount_max_cents?: number | null;
  compensation_currency?: string | null;
  compensation_period?: string | null;
  organization?: { name?: string };
}

const HEADERS = { "user-agent": "JobSnipe/0.1 (personal job alerts)", accept: "application/json" };
/** Results per request, and a cap on pages per search so one board can't stall a run. */
export const PAGE_SIZE = 100;
export const MAX_PAGES = 30;

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000), headers: { ...HEADERS, ...init.headers } });
  if (!res.ok) throw new HttpError(res.status, url);
  return res;
}

/** A board's Getro id, read from its page (it's in the data the page is built from). */
export async function getroCollectionId(host: string): Promise<string> {
  const html = await (await call(`https://${host}/jobs`)).text();
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  const id = m && JSON.parse(m[1])?.props?.pageProps?.network?.id;
  if (!id) throw new Error(`not a Getro board: ${host}`);
  return String(id);
}

export function toDiscoverJob(j: GetroJob, via: string): DiscoverJob | undefined {
  if (!j.title || !j.url) return undefined;
  const wm = j.work_mode?.toLowerCase();
  const min = j.compensation_amount_min_cents;
  const max = j.compensation_amount_max_cents;
  const yearly = (j.compensation_period ?? "year") === "year";
  const board = parseBoardUrl(j.url);
  return {
    id: discoverId(j.url),
    company: j.organization?.name?.trim() || "Unknown company",
    title: j.title.trim(),
    locations: (j.locations ?? []).filter(Boolean),
    workplace: wm === "remote" ? "remote" : wm === "hybrid" ? "hybrid" : wm === "on_site" ? "onsite" : undefined,
    url: j.url,
    postedAt: j.created_at ? new Date(j.created_at * 1000).toISOString() : undefined,
    comp: min && max && yearly ? { min: min / 100, max: max / 100, currency: (j.compensation_currency ?? "USD").toUpperCase() } : undefined,
    ats: board?.ats,
    board: board?.board,
    via: [via],
  };
}

/** Every job on a board matching any of the searches (e.g. "product manager"). */
export async function searchGetro(collectionId: string, queries: string[], via: string): Promise<DiscoverJob[]> {
  const found = new Map<string, DiscoverJob>();
  for (const query of queries) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await call(`https://api.getro.com/api/v2/collections/${encodeURIComponent(collectionId)}/search/jobs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ hitsPerPage: PAGE_SIZE, page, filters: { page }, query }),
      });
      const jobs: GetroJob[] = (await res.json())?.results?.jobs ?? [];
      for (const j of jobs) {
        const d = toDiscoverJob(j, via);
        if (d) found.set(d.id, d);
      }
      if (jobs.length < PAGE_SIZE) break;
    }
  }
  return [...found.values()];
}
