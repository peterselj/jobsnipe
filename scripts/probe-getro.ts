// Temporary: run the real Getro reader against the boards (in CI, which can reach them).
import { getroCollectionId, searchGetro } from "../checker/src/discover/getro.js";
import { titleCheck, toFilters } from "../checker/src/filters.js";
const f = toFilters({ titles: { include: ["product manager", "product management", "product lead", "head of product", "director of product"], exclude: ["product marketing", "intern", "associate product manager"] } });
const realFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = (...a: Parameters<typeof fetch>) => (calls++, realFetch(...a));
for (const host of ["jobs.generalcatalyst.com", "jobs.khoslaventures.com", "jobs.accel.com", "jobs.thrivecap.com", "jobs.luxcapital.com"]) {
  const t = Date.now();
  calls = 0;
  try {
    const id = await getroCollectionId(host);
    const jobs = await searchGetro(id, f.titles.include, host, (title) => !titleCheck(title, f));
    const ny = jobs.filter((j) => j.locations.some((l) => /new york|toronto/i.test(l))).length;
    const remote = jobs.filter((j) => j.workplace === "remote").length;
    console.log(host, "jobs", jobs.length, "NY/Toronto", ny, "remote", remote, "own board known", jobs.filter((j) => j.ats).length, "requests", calls, `${((Date.now() - t) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.log(host, "error", (e as Error).message);
  }
}
