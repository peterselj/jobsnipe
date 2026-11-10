import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAshby } from "../src/ats/ashby.js";
import { fetchGreenhouse } from "../src/ats/greenhouse.js";
import { fetchLever } from "../src/ats/lever.js";

afterEach(() => vi.unstubAllGlobals());

/** Answer each URL that ends with a key; anything else is a 404. */
function stub(routes: Record<string, unknown>) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    const hit = Object.entries(routes).find(([end]) => url.endsWith(end));
    return hit ? Response.json(hit[1]) : new Response("nope", { status: 404 });
  });
  return calls;
}

const teamsOf = (r: Awaited<ReturnType<typeof fetchLever>>) => (r.unchanged ? [] : r.postings.map((p) => p.team));

describe("teams from each board", () => {
  it("Lever: department and team", async () => {
    stub({
      "/waabi?mode=json": [
        { id: "a", text: "Senior Manager, Driverless Operating Model", hostedUrl: "https://x/a", categories: { location: "San Francisco, CA", department: "Commercial", team: "Commercial Products" } },
        { id: "b", text: "Lead Product Manager", hostedUrl: "https://x/b", categories: { location: "Toronto, ON", department: "Product", team: "Product" } },
        { id: "c", text: "Office Manager", hostedUrl: "https://x/c", categories: { location: "Toronto, ON" } },
      ],
    });
    expect(teamsOf(await fetchLever("waabi", "Waabi"))).toEqual(["Commercial / Commercial Products", "Product", undefined]);
  });

  it("Ashby: department and team", async () => {
    stub({
      "/acme?includeCompensation=true": {
        jobs: [{ id: "a", title: "Partnerships Lead", jobUrl: "https://x/a", location: "New York", department: "Go To Market", team: "Product Partnerships" }],
      },
    });
    expect(teamsOf(await fetchAshby("acme", "Acme"))).toEqual(["Go To Market / Product Partnerships"]);
  });

  it("Greenhouse: departments come from a second read; a job in two is filed under both", async () => {
    const jobs = [1, 2, 3].map((id) => ({ id, title: `Job ${id}`, absolute_url: `https://x/${id}`, location: { name: "New York City, NY" } }));
    const calls = stub({
      "/acme/jobs": { jobs },
      "/acme/departments": {
        departments: [
          { name: "Product Management", jobs: [{ id: 1 }, { id: 2 }] },
          { name: "Operations", jobs: [{ id: 2 }] },
          { name: "No Department", jobs: [{ id: 3 }] },
        ],
      },
    });
    expect(teamsOf(await fetchGreenhouse("acme", "Acme"))).toEqual(["Product Management", "Product Management / Operations", undefined]);
    expect(calls).toHaveLength(2);
  });

  it("Greenhouse: a board still reads when its departments can't be", async () => {
    stub({ "/acme/jobs": { jobs: [{ id: 1, title: "Job 1", absolute_url: "https://x/1", location: { name: "Remote" } }] } });
    const r = await fetchGreenhouse("acme", "Acme");
    expect(r.unchanged ? 0 : r.postings.length).toBe(1);
    expect(teamsOf(r)).toEqual([undefined]);
  });
});
