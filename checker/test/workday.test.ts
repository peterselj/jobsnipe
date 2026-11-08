import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWorkday, postedOnToDate, workdayDetails } from "../src/ats/workday.js";
import { parseCompText } from "../src/normalize.js";

const BOARD = "acme.wd5.myworkdayjobs.com/acme/AcmeCareers";
const API = "https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/AcmeCareers";
const NOW = new Date(Date.UTC(2026, 10, 8, 12));

const listJob = (n: number, over: Record<string, unknown> = {}) => ({
  title: `Senior Product Manager ${n}`,
  externalPath: `/job/US-NY-New-York/Senior-Product-Manager-${n}_JR${1000 + n}`,
  locationsText: n % 2 ? "US, NY, New York" : "3 Locations",
  postedOn: "Posted 3 Days Ago",
  ...over,
});

/** A fake Workday search: `groups` are the job-category facet's values and how many jobs each has. */
function fakeWorkday(groups: Record<string, number>) {
  const calls: { facets: Record<string, string[]>; offset: number; limit: number }[] = [];
  let next = 0;
  const jobsIn = Object.fromEntries(Object.entries(groups).map(([g, count]) => [g, Array.from({ length: count }, () => listJob(next++))]));
  const all = Object.values(jobsIn).flat();
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url !== `${API}/jobs` || init?.method !== "POST") return new Response("nope", { status: 404 });
    const body = JSON.parse(String(init.body));
    calls.push({ facets: body.appliedFacets, offset: body.offset, limit: body.limit });
    if (body.limit > 20) return new Response("{}", { status: 400 });
    const group = body.appliedFacets.jobFamilyGroup?.[0];
    const jobs = group ? jobsIn[group] : all;
    const total = Math.min(jobs.length, 2000); // like Workday: one search stops at 2,000
    return Response.json({
      total: body.offset === 0 ? total : 0, // like Workday: only the first page says
      jobPostings: jobs.slice(body.offset, body.offset + body.limit),
      facets: [
        { facetParameter: "timeType", values: [{ id: "full", count: all.length }] },
        { facetParameter: "jobFamilyGroup", values: Object.entries(groups).map(([id, count]) => ({ id, count })) },
      ],
    });
  });
  return { calls, all };
}

afterEach(() => vi.unstubAllGlobals());

describe("Workday", () => {
  it("reads every page, 20 at a time, and turns jobs into postings", async () => {
    const { calls } = fakeWorkday({ eng: 45 });
    const r = await fetchWorkday(BOARD, "Acme", undefined, NOW);
    if (r.unchanged) throw new Error("expected postings");
    expect(calls.map((c) => c.offset).sort((a, b) => a - b)).toEqual([0, 20, 40]);
    expect(r.postings).toHaveLength(45);
    expect(r.partial).toBe(false);
    expect(r.postings[0]).toEqual({
      id: `workday:${BOARD}:JR1000`,
      source: "workday",
      companyKey: `workday:${BOARD}`,
      company: "Acme",
      title: "Senior Product Manager 0",
      locations: ["3 locations"],
      workplace: undefined,
      url: "https://acme.wd5.myworkdayjobs.com/AcmeCareers/job/US-NY-New-York/Senior-Product-Manager-0_JR1000",
      atsPostedAt: "2026-11-05T12:00:00.000Z",
      compChecked: false,
      locationsFromDetails: true,
    });
    expect(r.postings[1].locations).toEqual(["US, NY, New York"]);
  });

  it("says unchanged when the jobs are the same, even as 'posted N days ago' ticks over", async () => {
    fakeWorkday({ eng: 5 });
    const first = await fetchWorkday(BOARD, "Acme", undefined, NOW);
    if (first.unchanged) throw new Error("expected postings");
    expect(await fetchWorkday(BOARD, "Acme", first.etag, new Date(NOW.getTime() + 86_400_000))).toEqual({ unchanged: true });
  });

  it("splits a board past Workday's 2,000-job cap by job category", async () => {
    const { calls } = fakeWorkday({ eng: 1500, sales: 1000 });
    const r = await fetchWorkday(BOARD, "Acme", undefined, NOW);
    if (r.unchanged) throw new Error("expected postings");
    expect(r.postings).toHaveLength(2500);
    expect(r.partial).toBe(false);
    // The time-type facet can't split it (one value holds everything); job category can.
    const split = calls.filter((c) => c.facets.jobFamilyGroup);
    expect(split.filter((c) => c.facets.jobFamilyGroup[0] === "eng")).toHaveLength(75);
    expect(split.filter((c) => c.facets.jobFamilyGroup[0] === "sales")).toHaveLength(50);
    expect(calls.filter((c) => c.facets.timeType)).toHaveLength(0);
  });

  it("only reads real Workday hosts", async () => {
    await expect(fetchWorkday("evil.example.com/a/b", "X")).rejects.toThrow(/not a Workday board/);
  });

  it("reads a job's places and pay from its own page", async () => {
    vi.stubGlobal("fetch", async (url: string) =>
      url === `${API}/job/US-NY-New-York/Senior-Product-Manager-0_JR1000`
        ? Response.json({
            jobPostingInfo: {
              location: "US, NY, New York",
              additionalLocations: ["Canada, ON, Toronto", "US, CA, Santa Clara"],
              country: { descriptor: "United States of America" },
              remoteType: "Hybrid",
              jobDescription: "<p>The base salary range is 152,000 USD &ndash; 241,500 USD for Level 3; and 184,000 USD – 287,500 USD for Level 4.</p>",
            },
          })
        : new Response("nope", { status: 404 }),
    );
    const p = { id: "x", source: "workday" as const, companyKey: "x", company: "Acme", title: "t", locations: ["3 locations"], url: "https://acme.wd5.myworkdayjobs.com/AcmeCareers/job/US-NY-New-York/Senior-Product-Manager-0_JR1000" };
    expect(await workdayDetails(BOARD, p)).toEqual({
      comp: { min: 152000, max: 287500, currency: "USD" },
      locations: ["US, NY, New York, United States of America", "Canada, ON, Toronto", "US, CA, Santa Clara"],
      workplace: "hybrid",
    });
    await expect(workdayDetails(BOARD, { ...p, url: "https://elsewhere.example/job/1" })).rejects.toThrow(/doesn't match/);
  });

  it("dates 'posted N days ago'", () => {
    expect(postedOnToDate("Posted Today", NOW)).toBe(NOW.toISOString());
    expect(postedOnToDate("Posted Yesterday", NOW)).toBe("2026-11-07T12:00:00.000Z");
    expect(postedOnToDate("Posted 30+ Days Ago", NOW)).toBe("2026-10-08T12:00:00.000Z");
    expect(postedOnToDate("", NOW)).toBeUndefined();
  });

  it("reads pay written with the currency after the number", () => {
    expect(parseCompText("152,000 USD – 241,500 USD")).toEqual({ min: 152000, max: 241500, currency: "USD" });
    expect(parseCompText("$149,000 USD - $204,500 USD")).toEqual({ min: 149000, max: 204500, currency: "USD" });
    expect(parseCompText("Between 25,000 - 100,000 users a day")).toBeUndefined();
  });
});

describe("Workday entries missing fields", () => {
  it("skips a job entry with no link or title instead of failing the whole board, and closes nothing that read", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({
        total: 3,
        jobPostings: [listJob(1), { title: "Placeholder with no link" }, { externalPath: "/job/x/No-Title_JR9" }],
        facets: [],
      }),
    );
    const r = await fetchWorkday(BOARD, "Acme", undefined, NOW);
    if (r.unchanged) throw new Error("expected postings");
    expect(r.postings.map((p) => p.id)).toEqual([`workday:${BOARD}:JR1001`]);
    expect(r.partial).toBe(true); // a job we couldn't read might still be open
  });
});
