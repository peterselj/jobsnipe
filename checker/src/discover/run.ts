import { linkOwner, parseBoardUrl } from "../../../shared/ats.js";
import { HttpError } from "../ats/http.js";
import { fetchers } from "../ats/index.js";
import { greenhouseDetails } from "../ats/greenhouse.js";
import { workdayDetails } from "../ats/workday.js";
import { digestEmail, matchEmail, type Mailer } from "../email.js";
import { evaluate, titleCheck, toFilters } from "../filters.js";
import type { CompanyRow, Store, WatchRow } from "../store.js";
import type { BoardResult, Filters, Person, Posting } from "../types.js";
import { jobsFromEmail } from "./email.js";
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
/** Jobs from job-alert emails are shown this long after the email (there's no board to re-check). */
export const EMAILED_OPEN_FOR_DAYS = 14;
const DIGEST_DAYS = { daily: 1, weekly: 7, biweekly: 14 } as const;
/** Digest lists stop here; the rest are on the page. */
export const DIGEST_MAX = 30;

export const MAX_TITLE_SEARCHES = 12;
/** Pay lookups on companies' own boards per run, so a big first read can't stall the check. */
export const MAX_PAY_LOOKUPS = 40;

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

/**
 * VC boards sometimes list the same job twice under different companies (Salesforce's Slack jobs
 * also show up as "Airkit", a company it bought). Same title, same place, links to the same company:
 * keep one, the one with pay if either has it, listed by every board that had either.
 */
function dedupe(rows: { j: DiscoverJob; r: { where?: string } }[]) {
  const keep = new Map<string, { j: DiscoverJob; r: { where?: string } }>();
  for (const row of rows) {
    const key = `${row.j.title.trim().toLowerCase()}|${row.r.where ?? ""}|${linkOwner(row.j.url) ?? row.j.url}`;
    const seen = keep.get(key);
    if (!seen) keep.set(key, row);
    else {
      const [winner, loser] = !seen.j.comp && row.j.comp ? [row, seen] : [seen, row];
      winner.j = { ...winner.j, via: [...new Set([...winner.j.via, ...loser.j.via])] };
      keep.set(key, winner);
    }
  }
  rows.splice(0, rows.length, ...keep.values());
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

export type LookupPay = (j: DiscoverJob) => Promise<Posting["comp"]>;

/** The job's id on its own board, from its link (".../jobs/123", "?gh_jid=123", or the last part). */
function jobIdFromLink(url: string): string | undefined {
  try {
    const u = new URL(url);
    const gh = u.searchParams.get("gh_jid") ?? u.pathname.match(/\/jobs\/(\d+)/)?.[1];
    return gh ?? u.pathname.split("/").filter(Boolean).pop();
  } catch {
    return undefined;
  }
}

/**
 * Pay from the company's own board. Greenhouse and Workday are read one job at a time; Ashby and
 * Lever only as a whole board, read once per run however many jobs need it.
 */
function payLookup(): LookupPay {
  const boards = new Map<string, Promise<BoardResult>>();
  return async (j) => {
    if (!j.ats || !j.board) return undefined;
    const p = asPosting(j);
    const id = jobIdFromLink(j.url);
    if (j.ats === "greenhouse") return id ? (await greenhouseDetails(j.board, { ...p, id: `greenhouse:${j.board}:${id}` })).comp : undefined;
    if (j.ats === "workday") return (await workdayDetails(j.board, p)).comp;
    const key = `${j.ats}:${j.board}`;
    if (!boards.has(key)) boards.set(key, fetchers[j.ats](j.board, j.company));
    const res = await boards.get(key)!;
    if (res.unchanged) return undefined;
    return res.postings.find((x) => x.url === j.url || (id && x.id.endsWith(`:${id}`)))?.comp;
  };
}

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
  lookupPay?: LookupPay;
  log?: (msg: string) => void;
  redact: (s: string) => string;
}

export async function runDiscover(o: DiscoverOptions): Promise<{ boards: number; emails: number; errors: string[] }> {
  const { store, now } = o;
  const iso = now.toISOString();
  const log = o.log ?? (() => {});
  const search = o.search ?? searchSource;
  const out = { boards: 0, emails: 0, errors: [] as string[] };

  const filters = new Map<string, Filters>(o.people.map((p) => [p.id, toFilters(p.criteria)]));
  const searchers = o.people.filter((p) => filters.get(p.id)!.titles.include.length);
  // Each title is searched on every VC board, so one person's list can't add more than a dozen.
  const queries = [...new Set(searchers.flatMap((p) => filters.get(p.id)!.titles.include.slice(0, MAX_TITLE_SEARCHES)))];

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

  // Job-alert emails: read what arrived since the last run. Their jobs belong to whoever's inbox it was.
  const emails = await store.unreadEmails();
  if (emails.length) {
    const fromEmail: DiscoverJob[] = [];
    const read: { id: number; jobs_found: number }[] = [];
    for (const e of emails) {
      let jobs: DiscoverJob[] = [];
      try {
        jobs = jobsFromEmail(e);
      } catch (err) {
        out.errors.push(`reading an inbox email failed: ${o.redact(err instanceof Error ? err.message : String(err))}`);
      }
      fromEmail.push(...jobs);
      read.push({ id: e.id, jobs_found: jobs.length });
    }
    if (fromEmail.length) await store.saveDiscoverPostings(fromEmail, iso);
    await store.markEmailsRead(read, iso);
    log(`  inbox: ${emails.length} email(s), ${fromEmail.length} job(s)`);
  }

  // VC-board jobs count as closed once they're gone from the boards for two days; emailed jobs stay
  // for two weeks (alerts and newsletters come daily or weekly).
  const boardCutoff = new Date(now.getTime() - OPEN_FOR_DAYS * DAY).toISOString();
  const open = (await store.openDiscoverPostings(new Date(now.getTime() - EMAILED_OPEN_FOR_DAYS * DAY).toISOString())).filter(
    (j) => j.forProfile || (j.lastSeenAt ?? iso) >= boardCutoff,
  );

  // 2. VC boards often leave pay out when the company's own board lists it: look it up there, once
  //    per job, for jobs whose title fits someone.
  const fitsAnyone = (title: string) => searchers.some((p) => !titleCheck(title, filters.get(p.id)!));
  const needPay = open.filter((j) => !j.comp && !j.compChecked && j.ats && j.board && fitsAnyone(j.title)).slice(0, MAX_PAY_LOOKUPS);
  if (needPay.length) {
    const lookup = o.lookupPay ?? payLookup();
    const priced: { id: string; comp?: Posting["comp"] }[] = [];
    for (const j of needPay) {
      try {
        j.comp = await lookup(j);
        priced.push({ id: j.id, comp: j.comp });
      } catch (e) {
        // A job that's gone from its board won't come back; anything else is tried again next run.
        if (e instanceof HttpError && e.status === 404) priced.push({ id: j.id });
      }
    }
    if (priced.length) await store.saveDiscoverPay(priced);
    log(`  discover pay: ${priced.filter((x) => x.comp).length} of ${needPay.length} found on the company's own board`);
  }

  // 3. Per person: Discover matches (all filters pass, company not on their list), and the digest.
  //    Emailed jobs at a company on your list that JobSnipe can't check directly go to your Inbox
  //    instead, with an instant email like any new match.
  const alerted = await store.alerted();
  const newAlerts: { profile_id: string; posting_id: string }[] = [];
  for (const person of o.people) {
    const f = filters.get(person.id)!;
    const mine = o.watches.filter((w) => w.profile_id === person.id);
    const boards = new Set(mine.flatMap((w) => {
      const c = w.company_id !== null ? o.companies.get(w.company_id) : undefined;
      return c ? [`${c.ats}:${c.board}`] : [];
    }));
    const names = new Set(mine.map((w) => companyKey(w.name)));
    const unmonitored = new Set(mine.filter((w) => w.company_id === null).map((w) => companyKey(w.name)));
    const all: { j: DiscoverJob; r: ReturnType<typeof evaluate>; onList: boolean }[] = !f.titles.include.length
      ? []
      : open
          .filter((j) => !j.forProfile || j.forProfile === person.id)
          .flatMap((j) => {
            // An emailed job at a company on your list you can't check directly is one for your Inbox.
            const inbox = !!j.forProfile && unmonitored.has(companyKey(j.company));
            return inbox || !onList(j, boards, names) ? [{ j, r: evaluate(asPosting(j), f, now), onList: inbox }] : [];
          })
          .filter(({ r }) => r.pass);
    const listed = all.filter((x) => x.onList);
    const passing = all.filter((x) => !x.onList);
    dedupe(passing);
    await store.syncDiscoverMatches(person.id, [
      ...listed.map(({ j, r }) => ({ posting_id: j.id, where_label: r.where ?? null, flags: r.flags, on_list: true })),
      ...passing.map(({ j, r }) => ({ posting_id: j.id, where_label: r.where ?? null, flags: r.flags })),
    ]);
    for (const { j, r } of listed) {
      const key = `${person.id}|${j.id}`;
      if (alerted.has(key)) continue;
      try {
        if (!person.alerts_paused) await o.mailer.send(matchEmail(person.email, { ...asPosting(j), company: `${j.company} (${j.via.join(", ")})` }, r, now));
        alerted.add(key);
        newAlerts.push({ profile_id: person.id, posting_id: j.id });
        if (!person.alerts_paused) out.emails++;
      } catch (e) {
        out.errors.push(`match email failed: ${o.redact(e instanceof Error ? e.message : String(e))}`);
      }
    }

    if (!digestDue(person, now)) continue;
    const since = person.last_digest_at ? Date.parse(person.last_digest_at) : 0;
    const fresh = passing
      .filter(({ j }) => Date.parse(j.firstSeenAt ?? iso) > since)
      .sort((a, b) => (b.j.postedAt ?? "").localeCompare(a.j.postedAt ?? ""));
    try {
      // Paused or nothing new: no email, but the clock still moves, so the rhythm holds.
      if (fresh.length && !person.alerts_paused) {
        await o.mailer.send(digestEmail(person.email, fresh, person.digest_every ?? "daily", now, DIGEST_MAX));
        out.emails++;
        log(`  ✉ discover digest sent (${fresh.length} roles)`);
      }
      await store.markDigested(person.id, iso);
    } catch (e) {
      // Not marked, so the next run tries again.
      out.errors.push(`digest email failed: ${o.redact(e instanceof Error ? e.message : String(e))}`);
    }
  }
  await store.recordAlerts(newAlerts);
  return out;
}
