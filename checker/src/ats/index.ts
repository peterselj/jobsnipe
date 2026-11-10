import type { Ats, BoardResult, Details, Posting } from "../types.js";
import { fetchAshby } from "./ashby.js";
import { fetchGreenhouse, greenhouseDetails } from "./greenhouse.js";
import { fetchLever } from "./lever.js";
import { fetchRecruitee } from "./recruitee.js";
import { fetchSmartRecruiters, smartRecruitersDetails } from "./smartrecruiters.js";
import { fetchWorkday, workdayDetails } from "./workday.js";

export { boardUrl } from "../../../shared/ats.js";

export const fetchers: Record<Ats, (board: string, company: string, etag?: string) => Promise<BoardResult>> = {
  greenhouse: fetchGreenhouse,
  lever: fetchLever,
  ashby: fetchAshby,
  workday: (board, company, etag) => fetchWorkday(board, company, etag),
  smartrecruiters: fetchSmartRecruiters,
  recruitee: fetchRecruitee,
};

/**
 * Boards whose list leaves out pay (and, on Workday, places); those are read from each posting's
 * own page, only when it could matter.
 */
export const detailFetchers: Partial<Record<Ats, (board: string, p: Posting) => Promise<Details>>> = {
  greenhouse: greenhouseDetails,
  workday: workdayDetails,
  smartrecruiters: smartRecruitersDetails,
};

