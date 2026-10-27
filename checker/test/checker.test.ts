import { describe, expect, it } from "vitest";
import { makeMailer, type Email, type Mailer } from "../src/email.js";
import { evaluate, toFilters } from "../src/filters.js";
import { htmlToText, parseCompText } from "../src/normalize.js";
import { runCheck as realRunCheck, type RunOptions } from "../src/run.js";
import type { Criteria, Posting } from "../src/types.js";
import { MemoryStore } from "./memoryStore.js";

const CRITERIA: Criteria = {
  titles: {
    include: ["product manager", "product management", "product lead", "head of product", "director of product"],
    exclude: ["product marketing", "intern", "associate product manager", "apm", "junior"],
  },
  seniority: { require: ["senior", "staff", "principal", "lead", "group", "director", "head", "vp"], unlevelled_pay_min: 180000 },
  locations: [
    { name: "NYC area", match: ["new york", "nyc", "brooklyn"] },
    { name: "Toronto area", match: ["toronto", "ontario", ", on"] },
  ],
  remote: { allowed: true, countries: ["US", "CA"] },
  comp_floor: { USD: 140000, CAD: 140000 },
};
const f = toFilters(CRITERIA);

const post = (over: Partial<Posting>): Posting => ({
  id: "greenhouse:acme:x", source: "greenhouse", companyKey: "greenhouse:acme", company: "Acme",
  title: "Senior Product Manager", locations: ["New York City, NY"], url: "https://x", ...over,
});

describe("filters", () => {
  it("title family and seniority", () => {
    for (const t of ["Senior Product Manager, Growth", "Group Product Manager", "Director of Product", "Lead Product Manager (Hybrid)"]) {
      expect(evaluate(post({ title: t }), f).pass, t).toBe(true);
    }
    for (const t of ["Product Marketing Manager", "Technical Program Manager", "Associate Product Manager", "Product Manager Intern", "Product Manager, Fan Data"]) {
      expect(evaluate(post({ title: t }), f).pass, t).toBe(false);
    }
    const high = evaluate(post({ title: "Product Manager, Platform", comp: { min: 305000, max: 385000, currency: "USD" } }), f);
    expect(high.pass).toBe(true);
    expect(high.flags.join()).toMatch(/no level in title/);
  });

  it("locations and remote scope", () => {
    expect(evaluate(post({ locations: ["Toronto, Ontario, Canada"] }), f).where).toBe("Toronto area");
    expect(evaluate(post({ locations: ["San Francisco, CA", "New York City, NY"] }), f).where).toBe("NYC area");
    expect(evaluate(post({ locations: ["Boston, MA"] }), f).pass).toBe(false);
    expect(evaluate(post({ locations: ["Remote-Friendly, United States"] }), f).where).toBe("Remote (US)");
    expect(evaluate(post({ locations: ["Remote - UK"] }), f).pass).toBe(false);
    expect(evaluate(post({ locations: ["Anywhere"], workplace: "remote" }), f).flags.join()).toMatch(/countries/);
  });

  it("pay floor", () => {
    expect(evaluate(post({ comp: { min: 100000, max: 130000, currency: "USD" } }), f).pass).toBe(false);
    expect(evaluate(post({ comp: { min: 155000, max: 185000, currency: "CAD" } }), f).pass).toBe(true);
    expect(evaluate(post({}), f).flags.join()).toMatch(/no pay range/);
  });

  it("empty or half-filled settings never crash and match nothing without titles", () => {
    expect(evaluate(post({}), toFilters({})).reasons.join()).toMatch(/no job titles/);
    expect(evaluate(post({}), toFilters(null)).pass).toBe(false);
    expect(evaluate(post({}), toFilters({ titles: { include: ["product manager"] }, locations: [{ name: "NYC", match: ["new york"] }] })).pass).toBe(true);
  });

  it("parses pay text", () => {
    expect(parseCompText(htmlToText("Annual Salary: &lt;span&gt;$305,000 &amp;mdash; $385,000 USD&lt;/span&gt;"))).toEqual({ min: 305000, max: 385000, currency: "USD" });
    expect(parseCompText("CA$155K – CA$185K")).toEqual({ min: 155000, max: 185000, currency: "CAD" });
    expect(parseCompText("The range is $60 - $65 per hour")).toBeUndefined();
    expect(parseCompText("We grew from $10M - $100M ARR")).toBeUndefined();
  });
});

// Tests never touch the network: pay lookups are stubbed unless a test supplies its own.
const runCheck = (o: RunOptions) => realRunCheck({ fetchComp: async () => undefined, ...o });

const JOSH = "josh-id";
const JAKE = "jake-id";
// Like a Greenhouse list entry: pay not fetched yet.
const job = (id: string, title = "Senior Product Manager"): Posting => post({ id: `greenhouse:acme:${id}`, title, url: `https://acme/${id}`, compChecked: false });
const at = (h: number) => new Date(Date.UTC(2026, 9, 27, h));

function setup() {
  const store = new MemoryStore();
  store.addCompany(1, "greenhouse", "acme", "Acme");
  store.people_ = [
    { id: JOSH, name: "Josh", email: "josh@example.com", criteria: CRITERIA, alert_mode: "immediate" },
    { id: JAKE, name: "Jake", email: "jake@example.com", criteria: {}, alert_mode: "immediate" },
  ];
  store.watches_ = [
    { id: 1, profile_id: JOSH, company_id: 1, name: "Acme", careers_url: null, note: null, baselined_at: null },
    { id: 2, profile_id: JOSH, company_id: null, name: "Corner Store", careers_url: null, note: "own site", baselined_at: null },
  ];
  const sent: Email[] = [];
  let failing = false;
  const mailer: Mailer = {
    describe: "test",
    async send(e) {
      if (failing) throw new Error("brevo down");
      sent.push(e);
    },
  };
  return { store, sent, mailer, failSends: (v: boolean) => (failing = v) };
}

describe("runCheck", () => {
  it("sends one summary first, then one email per new match; records matches and the run", async () => {
    const { store, sent, mailer } = setup();
    let board = [job("1"), job("2", "Software Engineer")];
    const fetch = async () => ({ postings: board });

    await runCheck({ store, mailer, fetch, now: at(1), trigger: "schedule" });
    expect(sent.map((e) => e.subject)).toEqual(["JobSnipe is watching: 1 open matches"]);
    expect(sent[0].text).toMatch(/Corner Store: own site/);
    expect(store.matches.get(JOSH)?.map((m) => m.posting_id)).toEqual(["greenhouse:acme:1"]);
    expect(store.matches.get(JAKE)).toEqual([]); // no filters set yet, so nothing matches

    await runCheck({ store, mailer, fetch, now: at(2) });
    expect(sent).toHaveLength(1);

    board = [job("1"), job("3"), job("4", "Product Marketing Manager")];
    const s = await runCheck({ store, mailer, fetch, now: at(3) });
    expect(sent.map((e) => e.subject).at(-1)).toBe("New match: Senior Product Manager at Acme (NYC area)");
    expect(s).toMatchObject({ companies_checked: 1, new_postings: 2, alerts_sent: 1, errors: [] });
    expect(store.runs.at(-1)).toMatchObject({ finished: true, new_postings: 2 });
  });

  it("uses each person's own name for the company", async () => {
    const { store, sent, mailer } = setup();
    store.watches_[0].name = "Acme Robotics";
    await runCheck({ store, mailer, fetch: async () => ({ postings: [job("1")] }), now: at(1) });
    expect(sent[0].text).toMatch(/Acme Robotics — Senior Product Manager/);
  });

  it("retries a failed send next run", async () => {
    const { store, sent, mailer, failSends } = setup();
    let board = [job("1")];
    const fetch = async () => ({ postings: board });
    await runCheck({ store, mailer, fetch, now: at(1) });
    board = [job("1"), job("2")];
    failSends(true);
    expect((await runCheck({ store, mailer, fetch, now: at(2) })).errors).toHaveLength(1);
    failSends(false);
    await runCheck({ store, mailer, fetch, now: at(3) });
    expect(sent.filter((e) => e.subject.startsWith("New match"))).toHaveLength(1);
  });

  it("keeps showing last-known matches while a board fails, and alerts once per failure streak", async () => {
    const { store, sent, mailer } = setup();
    let broken = false;
    const fetch = async () => {
      if (broken) throw new Error("HTTP 404");
      return { postings: [job("1")] };
    };
    await runCheck({ store, mailer, fetch, now: at(1) });
    broken = true;
    for (const h of [2, 3, 4]) await runCheck({ store, mailer, fetch, now: at(h) });
    expect(sent.filter((e) => /can't be checked/.test(e.subject))).toHaveLength(1);
    expect(store.matches.get(JOSH)?.map((m) => m.posting_id)).toEqual(["greenhouse:acme:1"]);
    expect(store.companies_.get(1)).toMatchObject({ consecutive_failures: 3, failure_alert_sent: true });
  });

  it("a newly added company gets its own summary, not an email per posting", async () => {
    const { store, sent, mailer } = setup();
    const fetch = async () => ({ postings: [job("1"), job("2")] });
    await runCheck({ store, mailer, fetch, now: at(1) });
    store.addCompany(2, "ashby", "globex", "Globex");
    store.watches_.push({ id: 3, profile_id: JOSH, company_id: 2, name: "Globex", careers_url: null, note: null, baselined_at: null });
    await runCheck({
      store, mailer, now: at(2),
      fetch: async (_ats, board) => ({ postings: board === "globex" ? [post({ id: "ashby:globex:9", companyKey: "ashby:globex", title: "Staff Product Manager" })] : [job("1"), job("2")] }),
    });
    expect(sent.map((e) => e.subject)).toEqual(["JobSnipe is watching: 2 open matches", "JobSnipe is watching: 1 open matches"]);
    expect(sent[1].text).toMatch(/Globex: 1 open/);
    expect(sent[1].text).not.toMatch(/Corner Store/);
  });
});

describe("mailer", () => {
  it("needs both Brevo settings to send, and dry-runs otherwise", () => {
    expect(makeMailer({ BREVO_API_KEY: "k", MAIL_FROM: "alerts@example.com" }).describe).toBe("Brevo as alerts@example.com");
    expect(makeMailer({ BREVO_API_KEY: "", MAIL_FROM: "" }).describe).toMatch(/dry run/);
    expect(makeMailer({ BREVO_API_KEY: "k", MAIL_FROM: "a@b.c" }, { dryRun: true }).describe).toMatch(/dry run/);
    expect(() => makeMailer({ BREVO_API_KEY: "k" })).toThrow(/MAIL_FROM/);
  });
});

describe("public logs", () => {
  it("never name people, companies, jobs or addresses", async () => {
    const { store, mailer } = setup();
    const lines: string[] = [];
    let broken = false;
    const fetch = async () => {
      if (broken) throw new Error("HTTP 404 from https://boards-api.greenhouse.io/v1/boards/acme/jobs");
      return { postings: [job("1")] };
    };
    await runCheck({ store, mailer, fetch, now: at(1), log: (l) => lines.push(l) });
    await runCheck({ store, mailer, fetch: async () => ({ postings: [job("1"), job("2")] }), now: at(2), log: (l) => lines.push(l) });
    broken = true;
    const s = await runCheck({ store, mailer, fetch, now: at(3), log: (l) => lines.push(l) });
    const failing: Mailer = { describe: "x", send: async () => { throw new Error("Brevo 400: invalid email josh@example.com"); } };
    const s2 = await runCheck({ store, mailer: failing, fetch: async () => ({ postings: [job("1"), job("2"), job("3")] }), now: at(4), log: (l) => lines.push(l) });
    const everything = [...lines, ...s.errors, ...s2.errors].join("\n");
    expect(everything).toMatch(/board #1/);
    for (const secret of ["Acme", "acme", "Josh", "josh", "Senior Product Manager", "greenhouse.io", "@example.com", "Corner Store"]) {
      expect(everything, secret).not.toContain(secret);
    }
  });
});

describe("efficiency", () => {
  it("writes nothing for a board that didn't change, and only the changes otherwise", async () => {
    const { store, mailer } = setup();
    let board = [job("1"), job("2"), job("3", "Software Engineer")];
    const fetch = async () => ({ postings: board });
    await runCheck({ store, mailer, fetch, now: at(1) });
    expect(store.postingWrites).toBe(3);
    await runCheck({ store, mailer, fetch, now: at(2) });
    expect(store.postingWrites).toBe(3); // nothing changed, nothing written
    board = [job("1"), job("4")]; // 2 and 3 closed, 4 new
    await runCheck({ store, mailer, fetch, now: at(3) });
    expect(store.postingWrites).toBe(6);
    board = [job("1"), job("2"), job("4")]; // 2 reopens
    await runCheck({ store, mailer, fetch, now: at(4) });
    expect(store.postingWrites).toBe(7);
    expect([...store.postings.values()].filter((p) => !p.closed).map((p) => p.id).sort()).toEqual(["greenhouse:acme:1", "greenhouse:acme:2", "greenhouse:acme:4"]);
  });

  it("fetches pay only for new postings whose title fits someone, and remembers it", async () => {
    const { store, mailer, sent } = setup();
    const asked: string[] = [];
    const fetchComp = async (_ats: unknown, _board: string, p: Posting) => {
      asked.push(p.id);
      return { min: 100000, max: 120000, currency: "USD" }; // under the 140K floor
    };
    let board = [job("1"), job("2", "Software Engineer")];
    const fetch = async () => ({ postings: board });
    await runCheck({ store, mailer, fetch, fetchComp, now: at(1) });
    expect(asked).toEqual(["greenhouse:acme:1"]); // not the engineer role
    expect(store.matches.get(JOSH)).toEqual([]); // pay below the floor, so no match
    await runCheck({ store, mailer, fetch, fetchComp, now: at(2) });
    expect(asked).toHaveLength(1); // known postings reuse the stored pay
    expect(store.matches.get(JOSH)).toEqual([]);
    board = [...board, job("5")];
    await runCheck({ store, mailer, fetch, fetchComp, now: at(3) });
    expect(asked).toEqual(["greenhouse:acme:1", "greenhouse:acme:5"]);
    expect(sent.filter((e) => e.subject.startsWith("New match"))).toHaveLength(0);
  });
});

describe("unchanged boards", () => {
  it("skip downloads and writes but still keep matches, and save the version tag only after changes are stored", async () => {
    const { store, sent, mailer } = setup();
    const tags: (string | undefined)[] = [];
    let board: Posting[] | "unchanged" = [job("1")];
    const fetch = async (_a: unknown, _b: string, _c: string, etag?: string) => {
      tags.push(etag);
      return board === "unchanged" ? { unchanged: true as const } : { postings: board, etag: `v${tags.length}` };
    };
    await runCheck({ store, mailer, fetch, now: at(1) });
    expect(store.companies_.get(1)!.etag).toBe("v1");
    board = "unchanged";
    const writes = store.postingWrites;
    await runCheck({ store, mailer, fetch, now: at(2) });
    expect(tags).toEqual([undefined, "v1"]); // sent last time's tag
    expect(store.postingWrites).toBe(writes);
    expect(store.matches.get(JOSH)?.map((m) => m.posting_id)).toEqual(["greenhouse:acme:1"]);
    expect(store.companies_.get(1)).toMatchObject({ etag: "v1", consecutive_failures: 0 });
    board = [job("1"), job("2")];
    await runCheck({ store, mailer, fetch, now: at(3) });
    expect(store.companies_.get(1)!.etag).toBe("v3");
    expect(sent.filter((e) => e.subject.startsWith("New match"))).toHaveLength(1);
  });

  it("look up pay for older postings once a new watcher's titles make them relevant", async () => {
    const { store, mailer } = setup();
    store.people_[1].criteria = { titles: { include: ["account manager"] }, locations: [{ name: "NYC", match: ["new york"] }] };
    let board = [job("1"), job("7", "Senior Account Manager")];
    const fetch = async () => ({ postings: board });
    const asked: string[] = [];
    const fetchComp = async (_a: unknown, _b: string, p: Posting) => {
      asked.push(p.id);
      return { min: 150000, max: 170000, currency: "USD" };
    };
    await runCheck({ store, mailer, fetch, fetchComp, now: at(1) });
    expect(asked).toEqual(["greenhouse:acme:1"]); // only Josh watches Acme so far
    store.watches_.push({ id: 9, profile_id: JAKE, company_id: 1, name: "Acme", careers_url: null, note: null, baselined_at: null });
    await runCheck({ store, mailer, fetch, fetchComp, now: at(2) });
    expect(asked).toEqual(["greenhouse:acme:1", "greenhouse:acme:7"]);
    expect(store.postings.get("greenhouse:acme:7")!.comp).toEqual({ min: 150000, max: 170000, currency: "USD" });
    await runCheck({ store, mailer, fetch, fetchComp, now: at(3) });
    expect(asked).toHaveLength(2); // never twice
  });
});
