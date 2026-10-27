import type { Posting } from "../types.js";
import { htmlToText, parseCompText } from "../normalize.js";
import { getJson } from "./http.js";

interface GhJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  first_published?: string;
  updated_at?: string;
  content?: string;
}

export const greenhouseApi = (board: string) =>
  `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`;

export async function fetchGreenhouse(board: string, company: string): Promise<Posting[]> {
  const data = await getJson<{ jobs: GhJob[] }>(greenhouseApi(board));
  return data.jobs.map((j) => {
    // Multi-city postings come as "New York City, NY; San Francisco, CA | Seattle, WA".
    const locations = (j.location?.name ?? "")
      .split(/[;|]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      id: `greenhouse:${board}:${j.id}`,
      source: "greenhouse",
      companyKey: `greenhouse:${board}`,
      company,
      title: j.title.trim(),
      locations,
      workplace: locations.some((l) => /remote/i.test(l)) ? "remote" : undefined,
      url: j.absolute_url,
      atsPostedAt: j.first_published ?? j.updated_at,
      comp: j.content ? parseCompText(htmlToText(j.content)) : undefined,
    } satisfies Posting;
  });
}
