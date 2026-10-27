import type { Ats, Posting } from "../types.js";
import { fetchAshby } from "./ashby.js";
import { fetchGreenhouse } from "./greenhouse.js";
import { fetchLever } from "./lever.js";

export const fetchers: Record<Ats, (board: string, company: string) => Promise<Posting[]>> = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
};

/** Public page a person would visit, for emails. */
export function boardUrl(ats: Ats, board: string): string {
  switch (ats) {
    case "greenhouse":
      return `https://job-boards.greenhouse.io/${board}`;
    case "lever":
      return `https://jobs.lever.co/${board}`;
    case "ashby":
      return `https://jobs.ashbyhq.com/${board}`;
  }
}
