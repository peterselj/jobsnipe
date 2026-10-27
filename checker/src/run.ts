import { boardUrl, fetchers } from "./ats/index.js";
import { baselineEmail, healthEmail, matchEmail, type BaselineCompany, type Mailer } from "./email.js";
import { evaluate, toFilters } from "./filters.js";
import type { CompanyRow, MatchRow, RunSummary, Store, StoredPosting } from "./store.js";
import type { Ats, FilterResult, Posting } from "./types.js";

/** Consecutive failed checks before we email about a broken board (2 = about two hours). */
export const FAILURE_ALERT_AFTER = 2;

type Fetch = (ats: Ats, board: string, company: string) => Promise<Posting[]>;

export interface RunOptions {
  store: Store;
  mailer: Mailer;
  trigger?: string;
  now?: Date;
  fetch?: Fetch;
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

export async function runCheck(opts: RunOptions): Promise<RunSummary> {
  const { store, mailer } = opts;
  const now = opts.now ?? new Date();
  const iso = now.toISOString();
  const log = opts.log ?? (() => {});
  const fetch: Fetch = opts.fetch ?? ((ats, board, company) => fetchers[ats](board, company));
  const summary: RunSummary = { companies_checked: 0, new_postings: 0, alerts_sent: 0, errors: [] };
  const runId = await store.startRun(opts.trigger ?? "manual");

  try {
    const [people, watches] = await Promise.all([store.people(), store.watches()]);
    const companyIds = [...new Set(watches.map((w) => w.company_id).filter((id): id is number => id !== null))];
    const companies = new Map((await store.companies(companyIds)).map((c) => [c.id, c]));

    // 1. Fetch each board once, however many people watch it.
    const fetched = new Map<number, Posting[]>();
    await mapLimit([...companies.values()], 4, async (c) => {
      let patch: Partial<CompanyRow>;
      try {
        const postings = await fetch(c.ats, c.board, c.name);
        fetched.set(c.id, postings);
        patch = { last_checked_at: iso, last_ok_at: iso, last_error: null, consecutive_failures: 0, failure_alert_sent: false, open_postings: postings.length };
        log(`✓ ${c.name}: ${postings.length} open`);
      } catch (e) {
        patch = { last_checked_at: iso, last_error: msg(e), consecutive_failures: c.consecutive_failures + 1 };
        summary.errors.push(`${c.name}: ${msg(e)}`);
        log(`✕ ${c.name}: ${msg(e)}`);
      }
      Object.assign(c, patch);
      await store.updateCompany(c.id, patch);
    });
    summary.companies_checked = companies.size;

    // 2. Save postings; work out what's open per board (last good check if today's failed).
    const open = new Map<number, StoredPosting[]>();
    for (const c of companies.values()) {
      const postings = fetched.get(c.id);
      if (!postings) {
        open.set(c.id, await store.openPostings(c));
        continue;
      }
      const firstSeen = await store.recordPostings(c, postings, iso);
      summary.new_postings += [...firstSeen.values()].filter((t) => t === iso).length;
      open.set(c.id, postings.map((p) => ({ ...p, companyId: c.id, firstSeenAt: firstSeen.get(p.id) ?? iso })));
    }

    // 3. Per person: matches for the page, a summary for newly watched companies, an email per new match.
    const alerted = await store.alerted();
    for (const person of people) {
      const filters = toFilters(person.criteria);
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
            log(`  ✉ ${person.name}: ${p.company} "${p.title}"`);
          } catch (e) {
            // Not recorded as sent, so the next run retries it.
            summary.errors.push(`email to ${person.name} failed: ${msg(e)}`);
          }
        }
      }

      await store.replaceMatches(person.id, matches);

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
          log(`  ✉ ${person.name}: watching summary (${summaryMatches.length} open matches)`);
        } catch (e) {
          summary.errors.push(`summary email to ${person.name} failed: ${msg(e)}`);
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
          summary.errors.push(`health email to ${person.name} failed: ${msg(e)}`);
        }
      }
      if (allSent) for (const c of failing) await store.updateCompany(c.id, { failure_alert_sent: true });
    }

    await store.prune(now);
  } catch (e) {
    summary.errors.push(`run failed: ${msg(e)}`);
    throw e;
  } finally {
    await store.finishRun(runId, summary);
  }
  return summary;
}
