import type { Ats, Posting } from "../types.js";
import { fetchAshby } from "./ashby.js";
import { fetchGreenhouse } from "./greenhouse.js";
import { fetchLever } from "./lever.js";

export { boardUrl } from "../../../shared/ats.js";

export const fetchers: Record<Ats, (board: string, company: string) => Promise<Posting[]>> = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
};

