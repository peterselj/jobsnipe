import type { Criteria, FilterResult, Filters, Posting } from "./types.js";

const lower = (xs: unknown): string[] =>
  Array.isArray(xs) ? xs.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim().toLowerCase()) : [];

/** Fill defaults and lowercase terms; tolerant of half-filled settings. */
export function toFilters(c: Criteria | null | undefined): Filters {
  const require = lower(c?.seniority?.require);
  return {
    titles: { include: lower(c?.titles?.include), exclude: lower(c?.titles?.exclude) },
    seniority: require.length ? { require, unlevelled_pay_min: c?.seniority?.unlevelled_pay_min } : undefined,
    locations: (c?.locations ?? [])
      .map((l) => ({ name: l?.name?.trim() || "Location", match: lower(l?.match) }))
      .filter((l) => l.match.length),
    remote: { allowed: c?.remote?.allowed ?? false, countries: (c?.remote?.countries ?? []).map((x) => x.toUpperCase()) },
    comp_floor: c?.comp_floor ?? {},
    max_age_days: c?.max_age_days && c.max_age_days > 0 ? c.max_age_days : undefined,
  };
}

/** Whole-word, case-insensitive match of a configured term (terms may contain punctuation, e.g. ", on"). */
export function hasTerm(text: string, term: string): boolean {
  const escaped = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(text.toLowerCase());
}

const COUNTRY_TERMS: Record<string, string[]> = {
  US: ["united states", "usa", "us", "u.s.", "america"],
  CA: ["canada", "can", "canadian"],
};

// Places that, when they're the only scope named, put a remote role out of reach.
const OTHER_REGIONS = [
  "uk", "united kingdom", "london", "europe", "emea", "apac", "latam", "india", "germany", "ireland",
  "france", "spain", "poland", "netherlands", "japan", "singapore", "australia", "brazil", "mexico",
  "estonia", "israel", "korea",
];

export function titleCheck(title: string, f: Filters): string | undefined {
  if (!f.titles.include.length) return "no job titles set in your filters";
  if (!f.titles.include.some((t) => hasTerm(title, t))) return "title outside role family";
  const ex = f.titles.exclude.find((t) => hasTerm(title, t));
  return ex ? `title excluded ("${ex}")` : undefined;
}

/**
 * Senior and up. Some companies put no level in titles at all, so an unlevelled title still
 * passes when its listed pay starts high enough.
 */
export function seniorityCheck(post: Posting, f: Filters): { fail?: string; flag?: string } {
  const s = f.seniority;
  if (!s || s.require.some((t) => hasTerm(post.title, t))) return {};
  const floor = s.unlevelled_pay_min;
  if (floor !== undefined && post.comp && post.comp.min >= floor) {
    return { flag: "no level in title; pay suggests senior" };
  }
  return { fail: "title isn't senior or above" };
}

export function locationCheck(post: Posting, f: Filters): { where?: string; flags: string[] } {
  const flags: string[] = [];
  for (const area of f.locations) {
    if (post.locations.some((l) => area.match.some((m) => hasTerm(l, m)))) return { where: area.name, flags };
  }
  const all = post.locations.join(" | ");
  const remote = post.workplace === "remote" || /remote/i.test(all);
  if (!remote || !f.remote.allowed) return { flags };
  const allowed = f.remote.countries.find((c) =>
    (COUNTRY_TERMS[c] ?? [c.toLowerCase()]).some((t) => hasTerm(all, t)),
  );
  if (allowed) return { where: `Remote (${allowed})`, flags };
  if (OTHER_REGIONS.some((r) => hasTerm(all, r))) return { flags };
  flags.push("remote, but the allowed countries aren't stated");
  return { where: "Remote (scope unclear)", flags };
}

const shortMoney = (currency: string, n: number) => `${currency === "CAD" ? "CA$" : currency === "USD" ? "$" : `${currency} `}${Math.round(n / 1000)}K`;

export function evaluate(post: Posting, f: Filters, now: Date = new Date()): FilterResult {
  const failed: FilterResult["failed"] = [];
  const titleFail = titleCheck(post.title, f);
  if (titleFail) failed.push({ check: "title", detail: titleFail });
  const level = seniorityCheck(post, f);
  if (level.fail) failed.push({ check: "seniority", detail: "No senior level in the title" });

  const loc = locationCheck(post, f);
  if (!loc.where) failed.push({ check: "location", detail: post.locations.join("; ") || "No location listed" });

  // Postings left up for months are usually evergreen listings or forgotten; past the limit they're
  // out of the inbox (still visible as a near miss).
  if (f.max_age_days && post.atsPostedAt) {
    const days = Math.floor((now.getTime() - Date.parse(post.atsPostedAt)) / 86_400_000);
    if (days > f.max_age_days) failed.push({ check: "age", detail: `Posted ${days} days ago (your limit: ${f.max_age_days})` });
  }

  const flags = [...loc.flags, ...(level.flag ? [level.flag] : [])];
  if (post.comp) {
    const floor = f.comp_floor[post.comp.currency];
    if (floor !== undefined && post.comp.max < floor) {
      failed.push({ check: "pay", detail: `Pay tops out at ${shortMoney(post.comp.currency, post.comp.max)} (your floor: ${shortMoney(post.comp.currency, floor)})` });
    } else if (floor === undefined) {
      flags.push(`pay listed in ${post.comp.currency}; no floor set for that currency`);
    }
  } else {
    flags.push("no pay range listed");
  }

  const reasons = failed.map((x) => (x.check === "location" ? `location (${x.detail})` : x.detail));
  return { pass: failed.length === 0, reasons, failed, flags, where: loc.where };
}

/**
 * A near miss: right job family (title fits), but exactly one other check failed. These are the
 * roles a person might want if they loosened one filter, so they're shown, never emailed.
 */
export function nearMiss(r: FilterResult): { check: Exclude<FilterResult["failed"][number]["check"], "title">; detail: string } | undefined {
  if (r.failed.length !== 1 || r.failed[0].check === "title") return undefined;
  return r.failed[0] as { check: "seniority" | "location" | "pay" | "age"; detail: string };
}
