import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchRecruitee } from "../src/ats/recruitee.js";
import { fetchSmartRecruiters, smartRecruitersDetails } from "../src/ats/smartrecruiters.js";

afterEach(() => vi.unstubAllGlobals());

// Shaped like the real answers (checked against live boards on Nov 10).
const srJob = (n: number, over: Record<string, unknown> = {}) => ({
  id: `74400000${n}`, name: `Senior Product Manager ${n}`, releasedDate: "2026-11-09T16:39:12.458Z",
  location: { city: "New York", region: "NY", country: "us", remote: false, hybrid: n % 2 === 0, fullLocation: "New York, NY, United States" },
  ...over,
});

describe("SmartRecruiters", () => {
  it("reads every page 100 at a time and turns jobs into postings", async () => {
    const all = Array.from({ length: 130 }, (_, i) => srJob(i));
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      const u = new URL(url);
      const offset = Number(u.searchParams.get("offset"));
      return Response.json({ totalFound: all.length, content: all.slice(offset, offset + Number(u.searchParams.get("limit"))) });
    });
    const r = await fetchSmartRecruiters("AcmeInc", "Acme");
    if (r.unchanged) throw new Error("expected postings");
    expect(asked).toEqual([
      "https://api.smartrecruiters.com/v1/companies/AcmeInc/postings?limit=100&offset=0",
      "https://api.smartrecruiters.com/v1/companies/AcmeInc/postings?limit=100&offset=100",
    ]);
    expect(r.postings).toHaveLength(130);
    expect(r.partial).toBe(false);
    expect(r.postings[1]).toEqual({
      id: "smartrecruiters:AcmeInc:744000001", source: "smartrecruiters", companyKey: "smartrecruiters:AcmeInc", company: "Acme",
      title: "Senior Product Manager 1", locations: ["New York, NY, United States"], workplace: undefined,
      url: "https://jobs.smartrecruiters.com/AcmeInc/744000001", atsPostedAt: "2026-11-09T16:39:12.458Z", compChecked: false,
    });
    expect(r.postings[2].workplace).toBe("hybrid");
    // Same jobs next hour: nothing to write.
    expect(await fetchSmartRecruiters("AcmeInc", "Acme", r.etag)).toEqual({ unchanged: true });
  });

  it("skips an entry with no id or title without closing anything, and reads pay from a job's own text", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      url.includes("/postings/")
        ? Response.json({ jobAd: { sections: { jobDescription: { text: "<p>Own the roadmap.</p>" }, additionalInformation: { text: "<p>The base salary range is $180,000 - $220,000 USD.</p>" } } } })
        : Response.json({ totalFound: 2, content: [srJob(1), { name: "No id" }] }),
    );
    const r = await fetchSmartRecruiters("AcmeInc", "Acme");
    if (r.unchanged) throw new Error("expected postings");
    expect(r.postings.map((p) => p.id)).toEqual(["smartrecruiters:AcmeInc:744000001"]);
    expect(r.partial).toBe(true);
    expect(await smartRecruitersDetails("AcmeInc", r.postings[0])).toEqual({ comp: { min: 180000, max: 220000, currency: "USD" } });
  });

  it("only ever asks SmartRecruiters, whatever the board is called", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("should not fetch"); });
    await expect(fetchSmartRecruiters("../../evil", "X")).rejects.toThrow(/not a SmartRecruiters company name/);
    await expect(fetchSmartRecruiters("a/b", "X")).rejects.toThrow(/not a SmartRecruiters/);
  });
});

describe("Recruitee", () => {
  const offer = (over: Record<string, unknown> = {}) => ({
    id: 2821648, title: "Senior Product Manager, Cards", careers_url: "https://careers.acme.com/o/senior-pm-cards",
    location: "Remote job", city: "Toronto", state_code: "ON", country: "Canada", remote: true, hybrid: false, on_site: false,
    published_at: "2026-11-10 07:45:05 UTC", status: "published", salary: { min: null, max: null, period: null, currency: null },
    description: "<p>Build cards.</p>", requirements: "<p>5 years.</p>", ...over,
  });

  it("reads a company's open jobs with place, date and pay", async () => {
    const asked: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      asked.push(url);
      return Response.json({ offers: [
        offer(),
        offer({ id: 2, title: "Staff PM", remote: false, hybrid: true, salary: { min: "170000", max: "210000", period: "year", currency: "cad" } }),
        offer({ id: 3, title: "Draft role", status: "draft" }),
        offer({ id: 4, title: "PM, Lending", description: "<p>Salary: $150,000 - $190,000 USD</p>", city: "", state_code: "", country: "", location: "New York" }),
      ] });
    });
    const r = await fetchRecruitee("acme", "Acme");
    if (r.unchanged) throw new Error("expected postings");
    expect(asked).toEqual(["https://acme.recruitee.com/api/offers/"]);
    expect(r.postings.map((p) => [p.id, p.title, p.locations, p.workplace, p.comp, p.atsPostedAt])).toEqual([
      ["recruitee:acme:2821648", "Senior Product Manager, Cards", ["Toronto, ON, Canada"], "remote", undefined, "2026-11-10T07:45:05.000Z"],
      ["recruitee:acme:2", "Staff PM", ["Toronto, ON, Canada"], "hybrid", { min: 170000, max: 210000, currency: "CAD" }, "2026-11-10T07:45:05.000Z"],
      ["recruitee:acme:4", "PM, Lending", ["New York"], "remote", { min: 150000, max: 190000, currency: "USD" }, "2026-11-10T07:45:05.000Z"],
    ]);
    expect(r.postings[0].url).toBe("https://careers.acme.com/o/senior-pm-cards");
    expect(await fetchRecruitee("acme", "Acme", r.etag)).toEqual({ unchanged: true });
  });

  it("never fetches from a host that isn't a plain Recruitee name", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("should not fetch"); });
    for (const bad of ["evil.example.com/x?", "acme.evil", "a/b", "ACME", "-acme", "acme@evil.example"]) {
      await expect(fetchRecruitee(bad, "X"), bad).rejects.toThrow(/not a Recruitee company name/);
    }
  });
});
