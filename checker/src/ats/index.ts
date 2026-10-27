import type { Ats, BoardResult, Posting } from "../types.js";
import { fetchAshby } from "./ashby.js";
import { fetchGreenhouse, greenhouseComp } from "./greenhouse.js";
import { fetchLever } from "./lever.js";

export { boardUrl } from "../../../shared/ats.js";

export const fetchers: Record<Ats, (board: string, company: string, etag?: string) => Promise<BoardResult>> = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
};

/** Boards whose list leaves out pay; their pay is fetched per posting, only when it could matter. */
export const compFetchers: Partial<Record<Ats, (board: string, p: Posting) => Promise<Posting["comp"]>>> = {
  greenhouse: greenhouseComp,
};

