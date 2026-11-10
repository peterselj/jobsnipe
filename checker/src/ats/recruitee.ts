import { createHash } from "node:crypto";
import { RECRUITEE_BOARD } from "../../../shared/ats.js";
import type { BoardResult, Posting } from "../types.js";
import { htmlToText, parseCompText } from "../normalize.js";
import { getJson } from "./http.js";

// Recruitee's public careers API: GET https://{company}.recruitee.com/api/offers/ returns every open
// job at once, with its text and (sometimes) a salary.

interface RcOffer {
  id?: number;
  title?: string;
  careers_url?: string;
  location?: string;
  city?: string;
  state_code?: string;
  country?: string;
  remote?: boolean;
  hybrid?: boolean;
  on_site?: boolean;
  published_at?: string; // "2026-11-10 07:45:05 UTC"
  status?: string;
  salary?: { min?: number | string | null; max?: number | string | null; period?: string | null; currency?: string | null };
  description?: string;
  requirements?: string;
}

const api = (board: string) => {
  // The name becomes part of the host we fetch from, so it must be a plain name and nothing else.
  if (!RECRUITEE_BOARD.test(board)) throw new Error("not a Recruitee company name");
  return `https://${board}.recruitee.com/api/offers/`;
};

/** "2026-11-10 07:45:05 UTC" as a standard date. */
function when(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = Date.parse(s.replace(" UTC", "Z").replace(" ", "T"));
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

function pay(o: RcOffer): Posting["comp"] {
  const min = Number(o.salary?.min);
  const max = Number(o.salary?.max);
  if (min > 0 && max > 0 && o.salary?.currency && /year|annual/i.test(o.salary.period ?? "")) {
    return { min, max, currency: o.salary.currency.toUpperCase() };
  }
  const text = htmlToText(`${o.description ?? ""}\n${o.requirements ?? ""}`);
  return text.trim() ? parseCompText(text) : undefined;
}

export async function fetchRecruitee(board: string, company: string, etag?: string): Promise<BoardResult> {
  const d = await getJson<{ offers?: RcOffer[] }>(api(board));
  const postings: Posting[] = [];
  let partial = false;
  for (const o of d.offers ?? []) {
    if (o.status && o.status !== "published") continue;
    if (!o.id || !o.title?.trim() || !o.careers_url) {
      partial = true; // can't be shown; don't close anything over it
      continue;
    }
    const where = [o.city, o.state_code, o.country].filter(Boolean).join(", ") || o.location?.trim() || "";
    postings.push({
      id: `recruitee:${board}:${o.id}`,
      source: "recruitee",
      companyKey: `recruitee:${board}`,
      company,
      title: o.title.trim(),
      locations: where ? [where] : [],
      workplace: o.remote ? "remote" : o.hybrid ? "hybrid" : o.on_site ? "onsite" : undefined,
      url: o.careers_url,
      atsPostedAt: when(o.published_at),
      comp: pay(o),
      compChecked: true,
    });
  }
  // Recruitee sends no version tag, so make one from what we keep.
  const tag =
    "rc1:" +
    createHash("sha1").update(postings.map((p) => `${p.id}|${p.title}|${p.locations.join(";")}|${p.workplace ?? ""}|${p.comp?.min ?? ""}-${p.comp?.max ?? ""}`).sort().join("\n")).digest("hex") +
    (partial ? ":partial" : "");
  if (etag === tag) return { unchanged: true };
  return { postings, etag: tag, partial };
}
