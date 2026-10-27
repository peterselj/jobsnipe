import type { SupabaseClient } from '@supabase/supabase-js';
import type { Ats, Feedback, Match, NewWatch, Profile, Run, Snapshot, Verdict, Watch, WatchFilters } from './types';

/** Everything the page reads and writes. SupabaseSource is the real one; DemoSource backs the demo. */
export interface DataSource {
  kind: 'supabase' | 'demo';
  load(): Promise<Snapshot>;
  setVerdict(m: Pick<Match, 'id' | 'company' | 'title' | 'url'>, v: Verdict | null): Promise<void>;
  addWatch(w: NewWatch): Promise<void>;
  changeBoard(watchId: number, ats: Ats, board: string): Promise<void>;
  removeWatch(watchId: number): Promise<void>;
  /** null = back to the usual filters for this company. */
  setWatchFilters(watchId: number, filters: WatchFilters | null): Promise<void>;
  saveProfile(patch: Partial<Pick<Profile, 'name' | 'email' | 'criteria' | 'alerts_paused'>>): Promise<void>;
  /** Permanently delete the signed-in account and everything about it. */
  deleteAccount(): Promise<void>;
  /** Starts a check; returns the time to wait for a run after. */
  requestCheck(): Promise<string>;
  latestRun(): Promise<Run | undefined>;
}

function fail(what: string, error: { message: string } | null): asserts error is null {
  if (error) throw new Error(`${what}: ${error.message}`);
}

function status(c: any): Watch['status'] {
  if (!c) return 'unmonitored';
  if (!c.last_checked_at) return 'pending';
  return c.consecutive_failures > 0 ? 'failing' : 'ok';
}

const toRun = (r: any): Run => ({
  startedAt: r.started_at,
  finishedAt: r.finished_at ?? undefined,
  trigger: r.trigger,
  errors: Array.isArray(r.errors) ? r.errors.length : 0,
});

export class SupabaseSource implements DataSource {
  kind = 'supabase' as const;

  constructor(private db: SupabaseClient, private userId: string) {}

  async load(): Promise<Snapshot> {
    const [profile, watches, matches, verdicts, run] = await Promise.all([
      this.db.from('profiles').select('id, name, email, criteria, alert_mode, alerts_paused').eq('id', this.userId).single(),
      this.db
        .from('watches')
        .select('id, name, careers_url, note, filters, company_id, companies(ats, board, last_checked_at, last_error, consecutive_failures, open_postings)')
        .order('created_at'),
      this.db
        .from('matches')
        .select('where_label, flags, near_miss, miss_detail, postings(id, company_id, title, url, ats_posted_at, comp_min, comp_max, comp_currency, first_seen_at)')
        .limit(2000),
      this.db.from('verdicts').select('*').limit(5000),
      this.latestRun(),
    ]);
    fail('Loading your profile', profile.error);
    fail('Loading companies', watches.error);
    fail('Loading matches', matches.error);
    fail('Loading feedback', verdicts.error);

    const nameByCompany = new Map<number, string>();
    const ws: Watch[] = (watches.data ?? []).map((w: any) => {
      const c = w.companies;
      if (w.company_id) nameByCompany.set(w.company_id, w.name);
      return {
        id: w.id,
        name: w.name,
        ats: c?.ats ?? 'none',
        board: c?.board,
        careersUrl: w.careers_url ?? undefined,
        note: w.note ?? undefined,
        status: status(c),
        openPostings: c?.open_postings ?? undefined,
        lastCheckedAt: c?.last_checked_at ?? undefined,
        lastError: c?.last_error ?? undefined,
        filters: w.filters ?? undefined,
      };
    });

    const ms: Match[] = (matches.data ?? [])
      .filter((m: any) => m.postings)
      .map((m: any) => {
        const p = m.postings;
        return {
          id: p.id,
          company: nameByCompany.get(p.company_id) ?? '',
          title: p.title,
          url: p.url,
          where: m.where_label ?? undefined,
          flags: m.flags ?? [],
          comp: p.comp_min != null && p.comp_max != null ? { min: p.comp_min, max: p.comp_max, currency: p.comp_currency } : undefined,
          atsPostedAt: p.ats_posted_at ?? undefined,
          firstSeenAt: p.first_seen_at,
          nearMiss: m.near_miss ?? undefined,
          missDetail: m.miss_detail ?? undefined,
        };
      })
      .sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt) || (b.atsPostedAt ?? '').localeCompare(a.atsPostedAt ?? ''));

    const feedback: Feedback = {};
    for (const v of verdicts.data ?? []) {
      feedback[v.posting_id] = {
        verdict: v.verdict ?? undefined,
        reason: v.reason ?? undefined,
        at: v.created_at,
        archivedAt: v.archived_at ?? undefined,
        company: v.company ?? '',
        title: v.title ?? '',
        url: v.url ?? undefined,
      };
    }

    return {
      profile: { ...profile.data, criteria: profile.data.criteria ?? {}, alerts_paused: !!profile.data.alerts_paused },
      watches: ws,
      matches: ms,
      feedback,
      lastRun: run,
    };
  }

  async setVerdict(m: Pick<Match, 'id' | 'company' | 'title' | 'url'>, v: Verdict | null) {
    if (!v) {
      const { error } = await this.db.from('verdicts').delete().eq('posting_id', m.id);
      return fail('Undoing', error);
    }
    const { error } = await this.db.from('verdicts').upsert({
      profile_id: this.userId,
      posting_id: m.id,
      verdict: v.verdict ?? null,
      reason: v.reason ?? null,
      archived_at: v.archivedAt ?? null,
      company: m.company,
      title: m.title,
      url: m.url || v.url || null,
      created_at: v.at,
    });
    fail('Saving', error);
  }

  async addWatch(w: NewWatch) {
    const { error } = await this.db.rpc('add_watch', {
      p_name: w.name,
      p_ats: w.ats === 'none' ? null : w.ats,
      p_board: w.board ?? null,
      p_careers_url: w.careers_url ?? null,
      p_note: w.note ?? null,
    });
    fail('Adding company', error);
  }

  async changeBoard(watchId: number, ats: Ats, board: string) {
    const { error } = await this.db.rpc('change_watch_board', { p_watch_id: watchId, p_ats: ats, p_board: board });
    fail('Changing board', error);
  }

  async removeWatch(watchId: number) {
    const { error } = await this.db.from('watches').delete().eq('id', watchId);
    fail('Removing company', error);
  }

  async setWatchFilters(watchId: number, filters: WatchFilters | null) {
    const { error } = await this.db.from('watches').update({ filters }).eq('id', watchId);
    fail('Saving company filters', error);
  }

  async saveProfile(patch: Partial<Pick<Profile, 'name' | 'email' | 'criteria' | 'alerts_paused'>>) {
    const { error } = await this.db.from('profiles').update(patch).eq('id', this.userId);
    fail('Saving settings', error);
  }

  async deleteAccount() {
    const { error } = await this.db.rpc('delete_my_account');
    fail('Deleting your account', error);
  }

  async requestCheck() {
    const { data, error } = await this.db.rpc('request_check', { p_reason: 'check now' });
    fail('Starting a check', error);
    return data as string;
  }

  async latestRun() {
    const { data, error } = await this.db.from('runs').select('*').order('started_at', { ascending: false }).limit(1);
    fail('Loading last check', error);
    return data?.[0] ? toRun(data[0]) : undefined;
  }
}
