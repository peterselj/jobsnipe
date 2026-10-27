import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Ats, Person, Posting, WatchFilters } from "./types.js";

export interface CompanyRow {
  id: number;
  ats: Ats;
  board: string;
  name: string;
  last_checked_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  failure_alert_sent: boolean;
  open_postings: number | null;
  etag: string | null;
}

export interface WatchRow {
  id: number;
  profile_id: string;
  company_id: number | null;
  name: string;
  careers_url: string | null;
  note: string | null;
  baselined_at: string | null;
  filters?: WatchFilters | null;
}

export interface StoredPosting extends Posting {
  companyId: number;
  firstSeenAt: string;
}

/** What's stored about a posting already seen, so a run only writes what changed. */
export interface KnownPosting {
  firstSeenAt: string;
  closed: boolean;
  comp?: Posting["comp"];
  compChecked: boolean;
}

export interface PostingChanges {
  added: Posting[];
  /** Back on the board after disappearing. */
  reopened: string[];
  /** No longer on the board. */
  closed: string[];
  /** Pay just looked up for postings already stored. */
  priced: { id: string; comp?: Posting["comp"] }[];
}

export interface MatchRow {
  profile_id: string;
  posting_id: string;
  where_label: string | null;
  flags: string[];
  /** Set for near misses: the one check that failed, and why. */
  near_miss?: "seniority" | "location" | "pay" | null;
  miss_detail?: string | null;
}

export interface RunSummary {
  companies_checked: number;
  new_postings: number;
  alerts_sent: number;
  errors: string[];
}

/** Everything the checker reads and writes. SupabaseStore in production, an in-memory one in tests. */
export interface Store {
  startRun(trigger: string): Promise<number>;
  finishRun(id: number, s: RunSummary): Promise<void>;
  people(): Promise<Person[]>;
  watches(): Promise<WatchRow[]>;
  companies(ids: number[]): Promise<CompanyRow[]>;
  updateCompany(id: number, patch: Partial<CompanyRow>): Promise<void>;
  /** Every stored posting for a board (open or closed). */
  knownPostings(company: CompanyRow): Promise<Map<string, KnownPosting>>;
  /** Write only what changed on a board since the last check. */
  applyPostingChanges(company: CompanyRow, changes: PostingChanges, at: string): Promise<void>;
  /** Postings still open as of the last good check (used when today's check failed). */
  openPostings(company: CompanyRow): Promise<StoredPosting[]>;
  /** `${profile_id}|${posting_id}` for every alert already sent. */
  alerted(): Promise<Set<string>>;
  recordAlerts(rows: { profile_id: string; posting_id: string }[]): Promise<void>;
  markBaselined(watchIds: number[], at: string): Promise<void>;
  /** Make a person's matches exactly `rows`, in one transaction (the inbox never sees a gap). */
  syncMatches(profileId: string, rows: MatchRow[]): Promise<void>;
  prune(now: Date): Promise<void>;
}

const DAY = 86_400_000;
const PAGE = 1000; // Supabase returns at most 1000 rows per request

function postingRow(companyId: number, p: Posting, at: string) {
  return {
    id: p.id,
    company_id: companyId,
    title: p.title,
    locations: p.locations,
    workplace: p.workplace ?? null,
    url: p.url,
    ats_posted_at: p.atsPostedAt ?? null,
    comp_min: p.comp ? Math.round(p.comp.min) : null,
    comp_max: p.comp ? Math.round(p.comp.max) : null,
    comp_currency: p.comp?.currency ?? null,
    comp_checked: p.compChecked ?? true,
    first_seen_at: at,
    last_seen_at: at,
  };
}

const compOf = (r: { comp_min: number | null; comp_max: number | null; comp_currency: string | null }) =>
  r.comp_min != null && r.comp_max != null && r.comp_currency ? { min: r.comp_min, max: r.comp_max, currency: r.comp_currency } : undefined;

export class SupabaseStore implements Store {
  private db: SupabaseClient;

  constructor(url: string, secretKey: string) {
    this.db = createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  private check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
    if (res.error) throw new Error(`${what}: ${res.error.message}`);
    return res.data;
  }

  /** Read every row of a query, a page at a time. */
  private async all<T>(what: string, page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const rows = this.check(await page(from, from + PAGE - 1), what) ?? [];
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }

  async startRun(trigger: string) {
    const row = this.check(await this.db.from("runs").insert({ trigger }).select("id").single(), "start run");
    return row!.id as number;
  }

  async finishRun(id: number, s: RunSummary) {
    this.check(await this.db.from("runs").update({ ...s, finished_at: new Date().toISOString() }).eq("id", id), "finish run");
  }

  async people() {
    return this.all<Person>("load profiles", (a, b) => this.db.from("profiles").select("id, name, email, criteria, alert_mode, alerts_paused").order("id").range(a, b));
  }

  async watches() {
    return this.all<WatchRow>("load watches", (a, b) =>
      this.db.from("watches").select("id, profile_id, company_id, name, careers_url, note, baselined_at, filters").order("id").range(a, b),
    );
  }

  async companies(ids: number[]) {
    if (!ids.length) return [];
    return this.check(await this.db.from("companies").select("*").in("id", ids), "load companies") as CompanyRow[];
  }

  async updateCompany(id: number, patch: Partial<CompanyRow>) {
    this.check(await this.db.from("companies").update(patch).eq("id", id), "update company");
  }

  async knownPostings(company: CompanyRow) {
    const rows = await this.all<any>("load postings", (a, b) =>
      this.db.from("postings").select("id, first_seen_at, closed_at, comp_min, comp_max, comp_currency, comp_checked").eq("company_id", company.id).order("id").range(a, b),
    );
    return new Map<string, KnownPosting>(
      rows.map((r) => [r.id, { firstSeenAt: r.first_seen_at, closed: r.closed_at !== null, comp: compOf(r), compChecked: r.comp_checked }]),
    );
  }

  async applyPostingChanges(company: CompanyRow, ch: PostingChanges, at: string) {
    for (let i = 0; i < ch.added.length; i += 500) {
      this.check(await this.db.from("postings").insert(ch.added.slice(i, i + 500).map((p) => postingRow(company.id, p, at))), "save new postings");
    }
    // Ids go in the request URL, so update in modest batches.
    for (const [ids, closed_at] of [[ch.reopened, null], [ch.closed, at]] as const) {
      for (let i = 0; i < ids.length; i += 100) {
        this.check(await this.db.from("postings").update({ closed_at }).in("id", ids.slice(i, i + 100)), "mark postings");
      }
    }
    for (const { id, comp } of ch.priced) {
      const pay = { comp_min: comp ? Math.round(comp.min) : null, comp_max: comp ? Math.round(comp.max) : null, comp_currency: comp?.currency ?? null };
      this.check(await this.db.from("postings").update({ ...pay, comp_checked: true }).eq("id", id), "save pay");
    }
  }

  async openPostings(company: CompanyRow) {
    const rows = await this.all<any>("load open postings", (a, b) =>
      this.db.from("postings").select("*").eq("company_id", company.id).is("closed_at", null).order("id").range(a, b),
    );
    return rows.map((r) => ({
      id: r.id,
      source: company.ats,
      companyKey: `${company.ats}:${company.board}`,
      company: company.name,
      title: r.title,
      locations: r.locations ?? [],
      workplace: r.workplace ?? undefined,
      url: r.url,
      atsPostedAt: r.ats_posted_at ?? undefined,
      comp: compOf(r),
      compChecked: r.comp_checked,
      companyId: company.id,
      firstSeenAt: r.first_seen_at,
    }));
  }

  async alerted() {
    const rows = await this.all<{ profile_id: string; posting_id: string }>("load alerts", (a, b) =>
      this.db.from("alerts").select("profile_id, posting_id").order("posting_id").range(a, b),
    );
    return new Set(rows.map((r) => `${r.profile_id}|${r.posting_id}`));
  }

  async recordAlerts(rows: { profile_id: string; posting_id: string }[]) {
    if (!rows.length) return;
    this.check(await this.db.from("alerts").upsert(rows, { onConflict: "profile_id,posting_id", ignoreDuplicates: true }), "record alerts");
  }

  async markBaselined(watchIds: number[], at: string) {
    if (!watchIds.length) return;
    this.check(await this.db.from("watches").update({ baselined_at: at }).in("id", watchIds), "mark watches");
  }

  async syncMatches(profileId: string, rows: MatchRow[]) {
    this.check(await this.db.rpc("sync_matches", { p_profile: profileId, p_rows: rows }), "save matches");
  }

  async prune(now: Date) {
    const before = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
    this.check(await this.db.from("postings").delete().lt("closed_at", before(30)), "prune postings");
    this.check(await this.db.from("alerts").delete().lt("sent_at", before(90)), "prune alerts");
    this.check(await this.db.from("runs").delete().lt("started_at", before(30)), "prune runs");
    this.check(await this.db.from("check_requests").delete().lt("requested_at", before(7)), "prune requests");
    this.check(await this.db.rpc("prune_unwatched_boards"), "prune unwatched boards");
  }
}
