// Temporary: read NVIDIA's real Workday board with the fixed reader (in CI, which can reach it).
import { fetchWorkday } from "../checker/src/ats/workday.js";
const realFetch = globalThis.fetch;
let entries = 0, noPath = 0, noTitle = 0;
globalThis.fetch = async (...a: Parameters<typeof fetch>) => {
  const res = await realFetch(...a);
  if (String(a[0]).endsWith("/jobs")) {
    const body = await res.clone().json().catch(() => ({}));
    for (const j of body.jobPostings ?? []) {
      entries++;
      if (!j.externalPath) noPath++;
      if (!j.title) noTitle++;
    }
  }
  return res;
};
const r = await fetchWorkday("nvidia.wd5.myworkdayjobs.com/nvidia/NVIDIAExternalCareerSite", "NVIDIA");
console.log("entries", entries, "missing link", noPath, "missing title", noTitle);
console.log(r.unchanged ? "unchanged" : `postings ${r.postings.length} partial ${r.partial}`);
