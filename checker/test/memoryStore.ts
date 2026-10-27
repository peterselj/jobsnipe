import type { CompanyRow, KnownPosting, MatchRow, PostingChanges, RunSummary, Store, StoredPosting, WatchRow } from "../src/store.js";
import type { Person } from "../src/types.js";

/** In-memory Store for tests; mirrors what SupabaseStore does against the real tables. */
export class MemoryStore implements Store {
  people_: Person[] = [];
  watches_: WatchRow[] = [];
  companies_ = new Map<number, CompanyRow>();
  postings = new Map<string, StoredPosting & { closed: boolean }>();
  /** Rows written to postings, to check that quiet runs write nothing. */
  postingWrites = 0;
  alerts = new Set<string>();
  matches = new Map<string, MatchRow[]>();
  runs: (RunSummary & { trigger: string; finished: boolean })[] = [];

  addCompany(id: number, ats: CompanyRow["ats"], board: string, name: string) {
    this.companies_.set(id, {
      id, ats, board, name, last_checked_at: null, last_ok_at: null, last_error: null,
      consecutive_failures: 0, failure_alert_sent: false, open_postings: null, etag: null,
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
  async knownPostings(c: CompanyRow) {
    const out = new Map<string, KnownPosting>();
    for (const [id, p] of this.postings) if (p.companyId === c.id) out.set(id, { firstSeenAt: p.firstSeenAt, closed: p.closed, comp: p.comp, compChecked: p.compChecked !== false });
    return out;
  }
  async applyPostingChanges(c: CompanyRow, ch: PostingChanges, at: string) {
    for (const p of ch.added) this.postings.set(p.id, { ...p, companyId: c.id, firstSeenAt: at, closed: false });
    for (const id of ch.reopened) this.postings.get(id)!.closed = false;
    for (const id of ch.closed) this.postings.get(id)!.closed = true;
    for (const { id, comp } of ch.priced) Object.assign(this.postings.get(id)!, { comp, compChecked: true });
    this.postingWrites += ch.added.length + ch.reopened.length + ch.closed.length + ch.priced.length;
  }
  async openPostings(c: CompanyRow) {
    return [...this.postings.values()].filter((p) => p.companyId === c.id && !p.closed);
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
  async syncMatches(profileId: string, rows: MatchRow[]) {
    this.matches.set(profileId, rows);
  }
  async prune() {}
}
