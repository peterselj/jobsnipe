import { parseBoardUrl } from "../../../shared/ats.js";
import { digestEmail, type Mailer } from "../email.js";
import { evaluate, titleCheck, toFilters } from "../filters.js";
import type { CompanyRow, Store, WatchRow } from "../store.js";
import type { Filters, Person, Posting } from "../types.js";
import { getroCollectionId, searchGetro } from "./getro.js";
import type { DiscoverJob, DiscoverSourceRow } from "./types.js";

/**
 * Discover: roles that pass all of someone's filters at companies they don't watch, found on VC
 * portfolio job boards. Those boards copy jobs from company boards about a day late, so they're read
 * every few hours, not hourly, and nothing is emailed one by one: a digest sums them up on the
 * schedule each person picks.
 */
export const DISCOVER_EVERY_HOURS = 4;
/** A Discover job not seen on any board for this long counts as closed. */
export const OPEN_FOR_DAYS = 2;
const DIGEST_DAYS = { daily: 1, weekly: 7, biweekly: 14 } as const;
/** Digest lists stop here; the rest are on the page. */
export const DIGEST_MAX = 30;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type SearchSource = (s: DiscoverSourceRow, queries: string[], fits: (title: string) => boolean) => Promise<{ jobs: DiscoverJob[]; collectionId?: string }>;

const searchSource: SearchSource = async (s, queries, fits) => {
  const collectionId = s.collection_id ?? (await getroCollectionId(s.host));
  return { jobs: await searchGetro(collectionId, queries, s.name, fits), collectionId };
};

/** "Acme AI, Inc." and "acme" are the same company for "is it already on my list?". */
export function companyKey(name: string): string {
  const words = name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const drop = new Set(["inc", "llc", "ltd", "corp", "co", "the", "ai", "labs", "hq", "technologies", "technology"]);
  const kept = words.filter((w) => !drop.has(w));
  return (kept.length ? kept : words).join("");
}

/** Already watched: the job's link is on one of your boards, or the company has the same name. */
function onList(j: DiscoverJob, boards: Set<string>, names: Set<string>): boolean {
  const b = j.ats && j.board ? { ats: j.ats, board: j.board } : parseBoardUrl(j.url);
  return (!!b && boards.has(`${b.ats}:${b.board}`)) || names.has(companyKey(j.company));
}

const asPosting = (j: DiscoverJob): Posting => ({
  id: j.id,
  source: j.ats ?? "greenhouse",
  companyKey: j.ats && j.board ? `${j.ats}:${j.board}` : "",
  company: j.company,
  title: j.title,
  locations: j.locations,
  workplace: j.workplace,
  url: j.url,
  atsPostedAt: j.postedAt,
  comp: j.comp,
  compChecked: true,
});

export function digestDue(person: Pick<Person, "digest_every" | "last_digest_at">, now: Date): boolean {
  const every = person.digest_every ?? "daily";
  if (every === "never") return false;
  if (!person.last_digest_at) return true;
  // An hour's slack, since checks run hourly at about the same minute.
  return now.getTime() - Date.parse(person.last_digest_at) >= DIGEST_DAYS[every] * DAY - HOUR;
}

export interface DiscoverOptions {
  store: Store;
  mailer: Mailer;
  people: Person[];
  watches: WatchRow[];
  companies: Map<number, CompanyRow>;
  now: Date;
  search?: SearchSource;
  log?: (msg: string) => void;
  redact: (s: string) => string;
}

export async function runDiscover(o: DiscoverOptions): Promise<{ boards: number; digests: number; errors: string[] }> {
  const { store, now } = o;
  const iso = now.toISOString();
  const log = o.log ?? (() => {});
  const search = o.search ?? searchSource;
  const out = { boards: 0, digests: 0, errors: [] as string[] };

  const filters = new Map<string, Filters>(o.people.map((p) => [p.id, toFilters(p.criteria)]));
  const searchers = o.people.filter((p) => filters.get(p.id)!.titles.include.length);
  const queries = [...new Set(searchers.flatMap((p) => filters.get(p.id)!.titles.include))];

  // 1. Read the boards that are due. Only jobs whose title fits someone are kept.
  if (queries.length) {
    const sources = (await store.discoverSources()).filter((s) => s.enabled);
    const due = sources.filter((s) => !s.last_checked_at || now.getTime() - Date.parse(s.last_checked_at) >= DISCOVER_EVERY_HOURS * HOUR - 10 * 60_000);
    const found = new Map<string, DiscoverJob>();
    for (const s of due) {
      try {
        const fits = (title: string) => searchers.some((p) => !titleCheck(title, filters.get(p.id)!));
        const { jobs, collectionId } = await search(s, queries, fits);
        const fit = jobs.filter((j) => fits(j.title));
        for (const j of fit) {
          const seen = found.get(j.id);
          found.set(j.id, seen ? { ...seen, via: [...new Set([...seen.via, ...j.via])] } : j);
        }
        await store.updateDiscoverSource(s.id, {
          last_checked_at: iso, last_ok_at: iso, last_error: null, open_postings: fit.length,
          ...(collectionId && collectionId !== s.collection_id ? { collection_id: collectionId } : {}),
        });
        out.boards++;
        log(`✓ discover board #${s.id}: ${fit.length} fit`);
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        await store.updateDiscoverSource(s.id, { last_checked_at: iso, last_error: m });
        out.errors.push(`discover board #${s.id}: ${o.redact(m)}`);
        log(`✕ discover board #${s.id}: ${o.redact(m)}`);
      }
    }
    if (found.size) await store.saveDiscoverPostings([...found.values()], iso);
  }

  // 2. Per person: Discover matches (all filters pass, company not on their list), and the digest.
  const open = await store.openDiscoverPostings(new Date(now.getTime() - OPEN_FOR_DAYS * DAY).toISOString());
  for (const person of o.people) {
    const f = filters.get(person.id)!;
    const mine = o.watches.filter((w) => w.profile_id === person.id);
    const boards = new Set(mine.flatMap((w) => {
      const c = w.company_id !== null ? o.companies.get(w.company_id) : undefined;
      return c ? [`${c.ats}:${c.board}`] : [];
    }));
    const names = new Set(mine.map((w) => companyKey(w.name)));
    const passing = !f.titles.include.length
      ? []
      : open
          .filter((j) => !onList(j, boards, names))
          .map((j) => ({ j, r: evaluate(asPosting(j), f, now) }))
          .filter(({ r }) => r.pass);
    await store.syncDiscoverMatches(person.id, passing.map(({ j, r }) => ({ posting_id: j.id, where_label: r.where ?? null, flags: r.flags })));

    if (!digestDue(person, now)) continue;
    const since = person.last_digest_at ? Date.parse(person.last_digest_at) : 0;
    const fresh = passing
      .filter(({ j }) => Date.parse(j.firstSeenAt ?? iso) > since)
      .sort((a, b) => (b.j.postedAt ?? "").localeCompare(a.j.postedAt ?? ""));
    try {
      // Paused or nothing new: no email, but the clock still moves, so the rhythm holds.
      if (fresh.length && !person.alerts_paused) {
        await o.mailer.send(digestEmail(person.email, fresh, person.digest_every ?? "daily", now, DIGEST_MAX));
        out.digests++;
        log(`  ✉ discover digest sent (${fresh.length} roles)`);
      }
      await store.markDigested(person.id, iso);
    } catch (e) {
      // Not marked, so the next run tries again.
      out.errors.push(`digest email failed: ${o.redact(e instanceof Error ? e.message : String(e))}`);
    }
  }
  return out;
}
