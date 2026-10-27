import type { CompanyRow, MatchRow, RunSummary, Store, StoredPosting, WatchRow } from "../src/store.js";
import type { Person, Posting } from "../src/types.js";

/** In-memory Store for tests; mirrors what SupabaseStore does against the real tables. */
export class MemoryStore implements Store {
  people_: Person[] = [];
  watches_: WatchRow[] = [];
  companies_ = new Map<number, CompanyRow>();
  postings = new Map<string, StoredPosting & { lastSeenAt: string }>();
  alerts = new Set<string>();
  matches = new Map<string, MatchRow[]>();
  runs: (RunSummary & { trigger: string; finished: boolean })[] = [];

  addCompany(id: number, ats: CompanyRow["ats"], board: string, name: string) {
    this.companies_.set(id, {
      id, ats, board, name, last_checked_at: null, last_ok_at: null, last_error: null,
      consecutive_failures: 0, failure_alert_sent: false, open_postings: null,
    });
  }

  async startRun(trigger: string) {
    this.runs.push({ trigger, finished: false, companies_checked: 0, new_postings: 0, alerts_sent: 0, errors: [] });
    return this.runs.length;
  }
  async finishRun(id: number, s: RunSummary) {
    Object.assign(this.runs[id - 1], s, { finished: true });
  }
  async people() {
    return this.people_;
  }
  async watches() {
    return this.watches_.map((w) => ({ ...w }));
  }
  async companies(ids: number[]) {
    return ids.map((id) => ({ ...this.companies_.get(id)! }));
  }
  async updateCompany(id: number, patch: Partial<CompanyRow>) {
    Object.assign(this.companies_.get(id)!, patch);
  }
  async recordPostings(c: CompanyRow, postings: Posting[], at: string) {
    const firstSeen = new Map<string, string>();
    for (const [id, p] of this.postings) if (p.companyId === c.id) firstSeen.set(id, p.firstSeenAt);
    for (const p of postings) {
      const first = firstSeen.get(p.id) ?? at;
      firstSeen.set(p.id, first);
      this.postings.set(p.id, { ...p, companyId: c.id, firstSeenAt: first, lastSeenAt: at });
    }
    return firstSeen;
  }
  async openPostings(c: CompanyRow) {
    return [...this.postings.values()].filter((p) => p.companyId === c.id && c.last_ok_at && p.lastSeenAt >= c.last_ok_at);
  }
  async alerted() {
    return new Set(this.alerts);
  }
  async recordAlerts(rows: { profile_id: string; posting_id: string }[]) {
    for (const r of rows) this.alerts.add(`${r.profile_id}|${r.posting_id}`);
  }
  async markBaselined(ids: number[], at: string) {
    for (const w of this.watches_) if (ids.includes(w.id)) w.baselined_at = at;
  }
  async replaceMatches(profileId: string, rows: MatchRow[]) {
    this.matches.set(profileId, rows);
  }
  async prune() {}
}
