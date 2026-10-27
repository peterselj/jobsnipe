import type { Posting } from "../types.js";
import { parseCompText } from "../normalize.js";
import { getJson } from "./http.js";

interface AshbyLocation {
  location?: string;
  address?: { postalAddress?: { addressCountry?: string } };
}

interface AshbyJob extends AshbyLocation {
  id: string;
  title: string;
  jobUrl: string;
  isListed?: boolean;
  workplaceType?: string;
  publishedAt?: string;
  secondaryLocations?: AshbyLocation[];
  compensation?: {
    scrapeableCompensationSalarySummary?: string;
    compensationTiers?: {
      components?: {
        compensationType?: string;
        interval?: string;
        currencyCode?: string | null;
        minValue?: number | null;
        maxValue?: number | null;
      }[];
    }[];
  };
}

export const ashbyApi = (board: string) =>
  `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`;

function describe(l: AshbyLocation): string {
  const name = l.location?.trim() ?? "";
  const country = l.address?.postalAddress?.addressCountry;
  return country && !name.toLowerCase().includes(country.toLowerCase()) ? `${name}, ${country}` : name;
}

/** Ashby gives structured salary per location tier; widen across tiers in the first currency seen. */
function compOf(j: AshbyJob): Posting["comp"] {
  let comp: Posting["comp"];
  for (const tier of j.compensation?.compensationTiers ?? []) {
    for (const c of tier.components ?? []) {
      if (c.compensationType !== "Salary" || !/year/i.test(c.interval ?? "")) continue;
      if (!c.minValue || !c.maxValue || !c.currencyCode) continue;
      if (!comp) comp = { min: c.minValue, max: c.maxValue, currency: c.currencyCode };
      else if (comp.currency === c.currencyCode) {
        comp = { ...comp, min: Math.min(comp.min, c.minValue), max: Math.max(comp.max, c.maxValue) };
      }
    }
  }
  return comp ?? parseCompText(j.compensation?.scrapeableCompensationSalarySummary ?? "");
}

export async function fetchAshby(board: string, company: string): Promise<Posting[]> {
  const data = await getJson<{ jobs: AshbyJob[] }>(ashbyApi(board));
  return data.jobs
    .filter((j) => j.isListed !== false)
    .map((j) => {
      const wt = j.workplaceType?.toLowerCase();
      return {
        id: `ashby:${board}:${j.id}`,
        source: "ashby",
        companyKey: `ashby:${board}`,
        company,
        title: j.title.trim(),
        locations: [j, ...(j.secondaryLocations ?? [])].map(describe).filter(Boolean),
        workplace: wt === "remote" ? "remote" : wt === "hybrid" ? "hybrid" : wt === "onsite" ? "onsite" : undefined,
        url: j.jobUrl,
        atsPostedAt: j.publishedAt,
        comp: compOf(j),
      } satisfies Posting;
    });
}
