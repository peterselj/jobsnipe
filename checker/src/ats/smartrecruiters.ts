import { createHash } from "node:crypto";
import { SMARTRECRUITERS_BOARD } from "../../../shared/ats.js";
import type { BoardResult, Details, Posting } from "../types.js";
import { htmlToText, parseCompText } from "../normalize.js";
import { getJson } from "./http.js";

// SmartRecruiters' public Posting API: GET /v1/companies/{company}/postings, 100 at a time, and
// /postings/{id} for one job's text. The list has no pay; a job's own page sometimes states it.

interface SrLocation {
  city?: string;
  region?: string;
  country?: string;
  remote?: boolean;
  hybrid?: boolean;
  fullLocation?: string;
}

interface SrListJob {
  id?: string;
  name?: string;
  releasedDate?: string;
  location?: SrLocation;
}

interface SrList {
  totalFound?: number;
  content?: SrListJob[];
}

interface SrJob {
  jobAd?: { sections?: Record<string, { text?: string } | undefined> };
}

const PAGE = 100;
/** Beyond this many pages a board is read only partly (and nothing on it is marked closed). */
const MAX_PAGES = 30;

const api = (board: string) => {
  if (!SMARTRECRUITERS_BOARD.test(board)) throw new Error("not a SmartRecruiters company name");
  return `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(board)}/postings`;
};

function place(l: SrLocation | undefined): string[] {
  if (!l) return [];
  const text = l.fullLocation?.trim() || [l.city, l.region, l.country?.toUpperCase()].filter(Boolean).join(", ");
  return text ? [text] : [];
}

export async function fetchSmartRecruiters(board: string, company: string, etag?: string): Promise<BoardResult> {
  const base = api(board);
  const jobs: SrListJob[] = [];
  let partial = false;
  for (let page = 0; ; page++) {
    if (page >= MAX_PAGES) {
      partial = true;
      break;
    }
    const d = await getJson<SrList>(`${base}?limit=${PAGE}&offset=${page * PAGE}`);
    const got = d.content ?? [];
    jobs.push(...got);
    if (got.length < PAGE || jobs.length >= (d.totalFound ?? Infinity)) break;
  }
  const byId = new Map<string, Posting>();
  for (const j of jobs) {
    // An entry without an id or a title can't be shown; skip it and don't close anything over it.
    if (!j.id || !j.name?.trim()) {
      partial = true;
      continue;
    }
    const id = `smartrecruiters:${board}:${j.id}`;
    byId.set(id, {
      id,
      source: "smartrecruiters",
      companyKey: `smartrecruiters:${board}`,
      company,
      title: j.name.trim(),
      locations: place(j.location),
      workplace: j.location?.remote ? "remote" : j.location?.hybrid ? "hybrid" : undefined,
      url: `https://jobs.smartrecruiters.com/${encodeURIComponent(board)}/${encodeURIComponent(j.id)}`,
      atsPostedAt: j.releasedDate,
      compChecked: false,
    });
  }
  const postings = [...byId.values()];
  // One version tag for the whole board, made from what we keep, so a quiet hour writes nothing.
  const tag =
    "sr1:" +
    createHash("sha1").update(postings.map((p) => `${p.id}|${p.title}|${p.locations.join(";")}|${p.workplace ?? ""}`).sort().join("\n")).digest("hex") +
    (partial ? ":partial" : "");
  if (etag === tag) return { unchanged: true };
  return { postings, etag: tag, partial };
}

/** Pay range from one posting's own text, when it states one. */
export async function smartRecruitersDetails(board: string, p: Posting): Promise<Details> {
  const id = p.id.split(":").pop()!;
  const j = await getJson<SrJob>(`${api(board)}/${encodeURIComponent(id)}`);
  const text = Object.values(j.jobAd?.sections ?? {}).map((s) => htmlToText(s?.text ?? "")).join("\n");
  return { comp: text.trim() ? parseCompText(text) : undefined };
}
