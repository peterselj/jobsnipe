import type { BoardResult, Details, Posting } from "../types.js";
import { htmlToText, parseCompText, teamLabel } from "../normalize.js";
import { getJson, getJsonIfChanged } from "./http.js";

interface GhJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  first_published?: string;
  updated_at?: string;
  content?: string;
}

// The list without descriptions is ~20x smaller (e.g. 0.5 MB instead of 9.6 MB for a big board).
// Descriptions are only needed to find a pay range, so they're fetched one posting at a time, only
// for new postings whose title could matter to someone (see greenhouseComp).
export const greenhouseApi = (board: string) =>
  `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs`;

/**
 * Which department(s) each job is filed under. The job list doesn't say, so this is a second read
 * (about the same size), made only when the list has changed. Best effort: without it the board
 * still reads fine, just with no teams.
 */
async function greenhouseTeams(board: string): Promise<Map<number, string>> {
  const teams = new Map<number, string>();
  try {
    const { departments } = await getJson<{ departments: { name?: string; jobs?: { id: number }[] }[] }>(
      `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/departments`,
    );
    for (const d of departments ?? []) {
      if (!d.name || /^no department$/i.test(d.name.trim())) continue;
      for (const j of d.jobs ?? []) teams.set(j.id, teamLabel(teams.get(j.id), d.name)!);
    }
  } catch {
    // No teams this time.
  }
  return teams;
}

export async function fetchGreenhouse(board: string, company: string, etag?: string): Promise<BoardResult> {
  const res = await getJsonIfChanged<{ jobs: GhJob[] }>(greenhouseApi(board), etag);
  if (res.unchanged) return { unchanged: true };
  const teams = await greenhouseTeams(board);
  const postings = res.data!.jobs.map((j) => {
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
      team: teams.get(j.id),
      comp: j.content ? parseCompText(htmlToText(j.content)) : undefined,
      compChecked: j.content !== undefined,
    } satisfies Posting;
  });
  return { postings, etag: res.etag };
}

/** Pay range from one posting's description. */
export async function greenhouseDetails(board: string, p: Posting): Promise<Details> {
  const id = p.id.split(":").pop()!;
  const j = await getJson<GhJob>(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${encodeURIComponent(id)}`);
  return { comp: j.content ? parseCompText(htmlToText(j.content)) : undefined };
}
