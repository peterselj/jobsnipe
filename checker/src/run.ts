import { boardUrl, compFetchers, fetchers } from "./ats/index.js";
import { baselineEmail, healthEmail, matchEmail, type BaselineCompany, type Mailer } from "./email.js";
import { evaluate, titleCheck, toFilters } from "./filters.js";
import type { CompanyRow, KnownPosting, MatchRow, PostingChanges, RunSummary, Store, StoredPosting } from "./store.js";
import type { Ats, BoardResult, FilterResult, Posting } from "./types.js";

/** Consecutive failed checks before we email about a broken board (2 = about two hours). */
export const FAILURE_ALERT_AFTER = 2;

/** Cap on per-posting pay lookups per board per run, so a big new watcher can't stall a run. */
export const MAX_PAY_LOOKUPS = 40;

type Fetch = (ats: Ats, board: string, company: string, etag?: string) => Promise<BoardResult>;
type FetchComp = (ats: Ats, board: string, p: Posting) => Promise<Posting["comp"]>;

export interface RunOptions {
  store: Store;
  mailer: Mailer;
  trigger?: string;
  now?: Date;
  fetch?: Fetch;
  /** Pay for one posting, for boards whose list leaves it out. */
  fetchComp?: FetchComp;
  log?: (msg: string) => void;
}

async function mapLimit<T>(items: T[], limit: number, fn: (t: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The repo is public, so its Actions logs are too, and every signed-in person can read `runs`.
 * Logs and stored errors therefore never name a person, company, board, job or email address:
 * boards are referred to by their number, and URLs and email addresses are stripped from errors.
 */
export const redact = (text: string) =>
  text.replace(/https?:\/\/\S+/g, "<url>").replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "<email>");

export async function runCheck(opts: RunOptions): Promise<RunSummary> {
  const { store, mailer } = opts;
  const now = opts.now ?? new Date();
  const iso = now.toISOString();
  const log = opts.log ?? (() => {});
  const fetch: Fetch = opts.fetch ?? ((ats, board, company, etag) => fetchers[ats](board, company, etag));
  const fetchComp: FetchComp = opts.fetchComp ?? (async (ats, board, p) => compFetchers[ats]?.(board, p));
  const summary: RunSummary = { companies_checked: 0, new_postings: 0, alerts_sent: 0, errors: [] };
  const runId = await store.startRun(opts.trigger ?? "manual");

  try {
    const [people, watches] = await Promise.all([store.people(), store.watches()]);
    const companyIds = [...new Set(watches.map((w) => w.company_id).filter((id): id is number => id !== null))];
    const companies = new Map((await store.companies(companyIds)).map((c) => [c.id, c]));

    // 1. Fetch each board once, however many people watch it. Most hours a board is unchanged and
    //    answers with no data (we send the version tag from last time).
    const fetched = new Map<number, BoardResult>();
    await mapLimit([...companies.values()], 4, async (c) => {
      let patch: Partial<CompanyRow>;
      try {
        const result = await fetch(c.ats, c.board, c.name, c.etag ?? undefined);
        fetched.set(c.id, result);
        patch = { last_checked_at: iso, last_ok_at: iso, last_error: null, consecutive_failures: 0, failure_alert_sent: false };
        if (!result.unchanged) patch.open_postings = result.postings.length;
        log(`✓ board #${c.id}: ${result.unchanged ? "unchanged" : `${result.postings.length} open`}`);
      } catch (e) {
        patch = { last_checked_at: iso, last_error: msg(e), consecutive_failures: c.consecutive_failures + 1 };
        summary.errors.push(`board #${c.id}: ${redact(msg(e))}`);
        log(`✕ board #${c.id}: ${redact(msg(e))}`);
      }
      Object.assign(c, patch);
      await store.updateCompany(c.id, patch);
    });
    summary.companies_checked = companies.size;

    // 2. Save only what changed on each board and work out what's open. Unchanged or failed boards
    //    use what's stored. Pay is looked up once per posting, only if its title fits someone.
    const filtersOf = new Map(people.map((p) => [p.id, toFilters(p.criteria)]));
    const open = new Map<number, StoredPosting[]>();
    for (const c of companies.values()) {
      const result = fetched.get(c.id);
      const changes: PostingChanges = { added: [], reopened: [], closed: [], priced: [] };
      let postings: StoredPosting[];
      let known: Map<string, KnownPosting> | undefined;
      if (!result || result.unchanged) {
        postings = await store.openPostings(c);
      } else {
        known = await store.knownPostings(c);
        const current = new Set(result.postings.map((p) => p.id));
        postings = result.postings.map((p) => {
          const k = known!.get(p.id);
          return k
            ? { ...p, comp: p.comp ?? k.comp, compChecked: p.compChecked || k.compChecked, companyId: c.id, firstSeenAt: k.firstSeenAt }
            : { ...p, companyId: c.id, firstSeenAt: iso };
        });
        changes.reopened = [...known].filter(([id, k]) => k.closed && current.has(id)).map(([id]) => id);
        changes.closed = [...known].filter(([id, k]) => !k.closed && !current.has(id)).map(([id]) => id);
      }

      const watchers = watches.filter((w) => w.company_id === c.id).map((w) => filtersOf.get(w.profile_id)!).filter(Boolean);
      const needPay = postings
        .filter((p) => p.compChecked === false && watchers.some((f) => !titleCheck(p.title, f)))
        .slice(0, MAX_PAY_LOOKUPS);
      await mapLimit(needPay, 4, async (p) => {
        try {
          p.comp = await fetchComp(c.ats, c.board, p);
          p.compChecked = true;
        } catch {
          // Left unchecked so the next run tries again; meanwhile it shows as "no pay range listed".
        }
      });

      // New postings are saved with their pay; stored ones get just the pay update.
      changes.added = known ? postings.filter((p) => !known!.has(p.id)) : [];
      changes.priced = needPay.filter((p) => p.compChecked && (!known || known.has(p.id))).map((p) => ({ id: p.id, comp: p.comp }));
      if (changes.added.length + changes.reopened.length + changes.closed.length + changes.priced.length) {
        await store.applyPostingChanges(c, changes, iso);
      }
      // Only remember the version tag once its changes are saved, or a crash could skip them for good.
      if (result && !result.unchanged && result.etag !== c.etag) await store.updateCompany(c.id, { etag: result.etag ?? null });
      summary.new_postings += changes.added.length;
      open.set(c.id, postings);
    }

    // 3. Per person: matches for the page, a summary for newly watched companies, an email per new match.
    const alerted = await store.alerted();
    for (const person of people) {
      const filters = filtersOf.get(person.id)!;
      const mine = watches.filter((w) => w.profile_id === person.id);
      const matches: MatchRow[] = [];
      const summaryMatches: { p: Posting; r: FilterResult }[] = [];
      const summaryCompanies: BaselineCompany[] = [];
      const toBaseline: number[] = [];
      const newAlerts: { profile_id: string; posting_id: string }[] = [];

      for (const w of mine) {
        if (w.company_id === null) {
          if (!w.baselined_at) {
            summaryCompanies.push({ name: w.name, ok: false, detail: w.note ?? "not monitored yet" });
            toBaseline.push(w.id);
          }
          continue;
        }
        const c = companies.get(w.company_id)!;
        const checkedNow = fetched.has(c.id);
        const results = (open.get(c.id) ?? []).map((p) => {
          const shown = { ...p, company: w.name }; // each person's own name for the company
          return { p: shown, r: evaluate(shown, filters) };
        });
        const passing = results.filter((x) => x.r.pass);
        for (const { p, r } of passing) matches.push({ profile_id: person.id, posting_id: p.id, where_label: r.where ?? null, flags: r.flags });

        if (!w.baselined_at) {
          // First look for this person: one summary of what's already open, not an email per posting.
          if (!checkedNow) {
            summaryCompanies.push({ name: w.name, ok: false, detail: `can't check yet: ${c.last_error ?? "fetch failed"}` });
            continue;
          }
          summaryCompanies.push({ name: w.name, ok: true, detail: `${c.open_postings ?? 0} open · ${boardUrl(c.ats, c.board)}` });
          toBaseline.push(w.id);
          summaryMatches.push(...passing.filter(({ p }) => !alerted.has(`${person.id}|${p.id}`)));
          continue;
        }
        if (!checkedNow) continue;

        const since = Date.parse(w.baselined_at);
        for (const { p, r } of passing) {
          const key = `${person.id}|${p.id}`;
          if (alerted.has(key) || Date.parse(p.firstSeenAt) <= since) continue;
          try {
            await mailer.send(matchEmail(person.email, p, r, now));
            alerted.add(key);
            newAlerts.push({ profile_id: person.id, posting_id: p.id });
            summary.alerts_sent++;
            log(`  ✉ new-match email sent`);
          } catch (e) {
            // Not recorded as sent, so the next run retries it.
            summary.errors.push(`match email failed: ${redact(msg(e))}`);
          }
        }
      }

      await store.syncMatches(person.id, matches);

      if (toBaseline.length) {
        summaryMatches.sort((a, b) => (b.p.atsPostedAt ?? "").localeCompare(a.p.atsPostedAt ?? ""));
        try {
          await mailer.send(baselineEmail(person.email, summaryMatches, summaryCompanies, now));
          summary.alerts_sent++;
          await store.markBaselined(toBaseline, iso);
          for (const { p } of summaryMatches) {
            alerted.add(`${person.id}|${p.id}`);
            newAlerts.push({ profile_id: person.id, posting_id: p.id });
          }
          log(`  ✉ watching-summary email sent (${summaryMatches.length} matches)`);
        } catch (e) {
          summary.errors.push(`summary email failed: ${redact(msg(e))}`);
        }
      }
      await store.recordAlerts(newAlerts);
    }

    // 4. Broken boards: one email per failure streak, to everyone watching.
    const failing = [...companies.values()].filter((c) => c.consecutive_failures >= FAILURE_ALERT_AFTER && !c.failure_alert_sent);
    if (failing.length) {
      let allSent = true;
      for (const person of people) {
        const mine = watches.filter((w) => w.profile_id === person.id && failing.some((c) => c.id === w.company_id));
        if (!mine.length) continue;
        const list = mine.map((w) => {
          const c = companies.get(w.company_id!)!;
          return { name: w.name, error: c.last_error ?? "", since: c.last_ok_at ?? undefined };
        });
        try {
          await mailer.send(healthEmail(person.email, list));
          summary.alerts_sent++;
        } catch (e) {
          allSent = false;
          summary.errors.push(`broken-board email failed: ${redact(msg(e))}`);
        }
      }
      if (allSent) for (const c of failing) await store.updateCompany(c.id, { failure_alert_sent: true });
    }

    await store.prune(now);
  } catch (e) {
    summary.errors.push(`run failed: ${redact(msg(e))}`);
    throw e;
  } finally {
    await store.finishRun(runId, summary);
  }
  return summary;
}
