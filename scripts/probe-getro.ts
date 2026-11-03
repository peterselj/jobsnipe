// Temporary: run the real Getro reader against the boards (in CI, which can reach them).
import { getroCollectionId, searchGetro } from "../checker/src/discover/getro.js";
for (const host of ["jobs.generalcatalyst.com", "jobs.khoslaventures.com", "jobs.accel.com", "jobs.thrivecap.com", "jobs.luxcapital.com"]) {
  const t = Date.now();
  try {
    const id = await getroCollectionId(host);
    const jobs = await searchGetro(id, ["product manager", "head of product"], host);
    const withBoard = jobs.filter((j) => j.ats).length;
    const pm = jobs.filter((j) => /product manager/i.test(j.title)).length;
    console.log(host, "id", id, "jobs", jobs.length, "titled PM", pm, "own board known", withBoard, `${((Date.now() - t) / 1000).toFixed(1)}s`);
    console.log("  e.g.", jobs.slice(0, 2).map((j) => ({ title: j.title, company: j.company, locations: j.locations, workplace: j.workplace, comp: j.comp, ats: j.ats, postedAt: j.postedAt })));
  } catch (e) {
    console.log(host, "error", (e as Error).message);
  }
}
