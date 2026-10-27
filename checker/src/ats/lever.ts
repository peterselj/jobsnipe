import type { BoardResult, Posting } from "../types.js";
import { parseCompText } from "../normalize.js";
import { getJsonIfChanged } from "./http.js";

interface LeverJob {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number;
  country?: string;
  workplaceType?: string;
  categories?: { location?: string; allLocations?: string[] };
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
  descriptionPlain?: string;
  additionalPlain?: string;
}

export const leverApi = (board: string) =>
  `https://api.lever.co/v0/postings/${encodeURIComponent(board)}?mode=json`;

export async function fetchLever(board: string, company: string, etag?: string): Promise<BoardResult> {
  const res = await getJsonIfChanged<LeverJob[]>(leverApi(board), etag);
  if (res.unchanged) return { unchanged: true };
  const postings = res.data!.map((j) => {
    const locs = j.categories?.allLocations?.length
      ? j.categories.allLocations
      : [j.categories?.location ?? ""];
    const locations = locs.filter(Boolean).map((l) => (j.country ? `${l}, ${j.country}` : l));
    const sr = j.salaryRange;
    const comp =
      sr?.min && sr.max && /year/i.test(sr.interval ?? "")
        ? { min: sr.min, max: sr.max, currency: (sr.currency ?? "USD").toUpperCase() }
        : parseCompText(`${j.additionalPlain ?? ""} ${j.descriptionPlain ?? ""}`);
    const wt = j.workplaceType?.toLowerCase();
    return {
      id: `lever:${board}:${j.id}`,
      source: "lever",
      companyKey: `lever:${board}`,
      company,
      title: j.text.trim(),
      locations,
      workplace: wt === "remote" || wt === "hybrid" || wt === "onsite" ? wt : undefined,
      url: j.hostedUrl,
      atsPostedAt: j.createdAt ? new Date(j.createdAt).toISOString() : undefined,
      comp,
      compChecked: true,
    } satisfies Posting;
  });
  return { postings, etag: res.etag };
}
