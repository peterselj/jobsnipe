// Temporary: run the real readers against live boards (in CI, which can reach them).
import { fetchRecruitee } from "../checker/src/ats/recruitee.js";
import { fetchSmartRecruiters, smartRecruitersDetails } from "../checker/src/ats/smartrecruiters.js";
const show = (p: any) => ({ title: p.title, locations: p.locations, workplace: p.workplace, url: p.url.slice(0, 70), posted: p.atsPostedAt, comp: p.comp });
const sr = await fetchSmartRecruiters("SWIGGY", "Swiggy");
if (!sr.unchanged) {
  console.log("SR postings", sr.postings.length, "partial", sr.partial, show(sr.postings[0]));
  console.log("SR details", await smartRecruitersDetails("SWIGGY", sr.postings[0]));
  console.log("SR unchanged on repeat", (await fetchSmartRecruiters("SWIGGY", "Swiggy", sr.etag)).unchanged === true);
}
const rc = await fetchRecruitee("bunq", "bunq");
if (!rc.unchanged) {
  console.log("RC postings", rc.postings.length, "partial", rc.partial, show(rc.postings[0]), "with pay", rc.postings.filter((p) => p.comp).length);
  console.log("RC unchanged on repeat", (await fetchRecruitee("bunq", "bunq", rc.etag)).unchanged === true);
}
