import { pageCanRead, probeBoard } from './ats';
import type { DataSource } from './source';
import type { Ats, InboxEmail, Match, NewWatch, Profile, Run, Snapshot, Verdict, Watch } from './types';

// Fictional companies and roles, so the public demo never shows anyone's real search.

const H = 3_600_000;
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * H).toISOString();

const PROFILE: Profile = {
  id: 'demo',
  name: 'Demo',
  email: 'demo@example.com',
  alert_mode: 'immediate',
  alerts_paused: false,
  digest_every: 'daily',
  inbox_token: null,
  criteria: {
    titles: { include: ['product manager', 'head of product'], exclude: ['product marketing', 'intern'] },
    seniority: { require: ['senior', 'staff', 'principal', 'lead', 'group', 'director', 'head'], unlevelled_pay_min: 180000 },
    locations: [{ name: 'NYC area', match: ['new york', 'nyc', 'brooklyn'] }, { name: 'Toronto area', match: ['toronto', 'ontario'] }],
    remote: { allowed: true, countries: ['US', 'CA'] },
    comp_floor: { USD: 140000, CAD: 140000 },
    max_age_days: 60,
  },
};

const MATCHES: Match[] = [
  { id: 'd1', company: 'Northwind Media', title: 'Senior Product Manager, Subscriptions', url: 'https://example.com/jobs/1', where: 'NYC area', flags: [], comp: { min: 175000, max: 210000, currency: 'USD' }, atsPostedAt: iso(1.5), firstSeenAt: iso(0.4) },
  { id: 'd2', company: 'Fieldline Robotics', title: 'Lead Product Manager, Fleet Platform', url: 'https://example.com/jobs/2', where: 'Toronto area', flags: [], comp: { min: 165000, max: 220000, currency: 'CAD' }, atsPostedAt: iso(20), firstSeenAt: iso(19) },
  { id: 'd3', company: 'Brightpath', title: 'Staff Product Manager, Growth', url: 'https://example.com/jobs/3', where: 'Remote (US)', flags: ['no pay range listed'], atsPostedAt: iso(70), firstSeenAt: iso(69) },
  { id: 'd4', company: 'Halcyon AI', title: 'Product Manager, Developer Platform', url: 'https://example.com/jobs/4', where: 'NYC area', flags: ['no level in title; pay suggests senior'], comp: { min: 240000, max: 300000, currency: 'USD' }, atsPostedAt: iso(150), firstSeenAt: iso(140) },
  { id: 'd6', company: 'Halcyon AI', title: 'Senior Product Manager, Payments', url: 'https://example.com/jobs/6', where: 'NYC area', flags: [], comp: { min: 110000, max: 135000, currency: 'USD' }, atsPostedAt: iso(30), firstSeenAt: iso(29), nearMiss: 'pay', missDetail: 'Pay tops out at $135K (your floor: $140K)' },
  { id: 'd7', company: 'Northwind Media', title: 'Staff Product Manager, Search', url: 'https://example.com/jobs/7', flags: [], comp: { min: 220000, max: 260000, currency: 'USD' }, atsPostedAt: iso(50), firstSeenAt: iso(49), nearMiss: 'location', missDetail: 'San Francisco, CA' },
  { id: 'd8', company: 'Brightpath', title: 'Product Manager, Onboarding', url: 'https://example.com/jobs/8', where: 'Remote (US)', flags: [], comp: { min: 130000, max: 150000, currency: 'USD' }, atsPostedAt: iso(80), firstSeenAt: iso(79), nearMiss: 'seniority', missDetail: 'No senior level in the title' },
  { id: 'd9', company: 'Halcyon AI', title: 'Lead Product Manager, Growth', url: 'https://example.com/jobs/9', where: 'NYC area', flags: [], comp: { min: 200000, max: 240000, currency: 'USD' }, atsPostedAt: iso(340 * 24), firstSeenAt: iso(300), nearMiss: 'age', missDetail: 'Posted 340 days ago (your limit: 60)' },
  { id: 'x1', company: 'Lumen Health', title: 'Senior Product Manager, Patient Experience', url: 'https://jobs.ashbyhq.com/lumenhealth/x1', where: 'NYC area', flags: [], comp: { min: 185000, max: 225000, currency: 'USD' }, atsPostedAt: iso(26), firstSeenAt: iso(20), via: ['General Catalyst', 'Thrive Capital'], ats: 'ashby', board: 'lumenhealth', stage: 'series_b', industries: ['Health Care', 'Biotechnology'] },
  { id: 'x2', company: 'Quarry Labs', title: 'Staff Product Manager, Developer Tools', url: 'https://jobs.lever.co/quarrylabs/x2', where: 'Remote (US)', flags: ['no pay range listed'], atsPostedAt: iso(50), firstSeenAt: iso(44), via: ['Accel'], stage: 'seed', industries: ['Developer Tools', 'SaaS'] },
  { id: 'x3', company: 'Tidewater', title: 'Group Product Manager, Payments', url: 'https://job-boards.greenhouse.io/tidewater/jobs/3', where: 'Toronto area', flags: [], comp: { min: 190000, max: 240000, currency: 'CAD' }, atsPostedAt: iso(80), firstSeenAt: iso(70), via: ['Lux Capital'], ats: 'greenhouse', board: 'tidewater', stage: 'ipo', industries: ['Fintech', 'Payments'] },
  { id: 'x4', company: 'Fernway', title: 'Senior Product Manager, Workflow Automation', url: 'https://careers.bigco.example/jobs/x4', where: 'NYC area', flags: [], comp: { min: 200000, max: 250000, currency: 'USD' }, atsPostedAt: iso(30), firstSeenAt: iso(28), via: ['Accel'] },
  { id: 'e1', company: 'Corner Store Co', title: 'Senior Product Manager, Loyalty', url: 'https://www.linkedin.com/jobs/view/4000000001/', where: 'NYC area', flags: ['no pay range listed'], atsPostedAt: iso(5), firstSeenAt: iso(4.5), via: ['LinkedIn alert'], onList: true },
  { id: 'd5', company: 'Northwind Media', title: 'Group Product Manager, Ads', url: 'https://example.com/jobs/5', where: 'Remote (scope unclear)', flags: ["remote, but the allowed countries aren't stated"], comp: { min: 210000, max: 250000, currency: 'USD' }, atsPostedAt: iso(400), firstSeenAt: iso(390) },
];

const DEMO_EMAILS: InboxEmail[] = [
  { id: 2, fromName: 'LinkedIn Job Alerts', fromAddress: 'jobalerts-noreply@linkedin.com', subject: '“senior product manager”: 12 new jobs in New York', receivedAt: iso(5), jobsFound: 12 },
  { id: 1, fromName: 'Gmail Team', fromAddress: 'forwarding-noreply@google.com', subject: 'Gmail Forwarding Confirmation - Receive Mail from you@gmail.com', receivedAt: iso(30), jobsFound: 0, text: 'Confirmation code: 123456789\n\nyou@gmail.com has requested to automatically forward mail to your email address.' },
];

const WATCHES: Watch[] = [
  { id: 1, name: 'Northwind Media', ats: 'greenhouse', board: 'northwind', status: 'ok', openPostings: 84, lastCheckedAt: iso(0.4) },
  { id: 2, name: 'Fieldline Robotics', ats: 'lever', board: 'fieldline', status: 'ok', openPostings: 31, lastCheckedAt: iso(0.4), filters: { locations: [{ name: 'Toronto area', match: ['toronto', 'ontario'] }], remote: { allowed: false } } },
  { id: 3, name: 'Brightpath', ats: 'ashby', board: 'brightpath', status: 'ok', openPostings: 22, lastCheckedAt: iso(0.4) },
  { id: 4, name: 'Halcyon AI', ats: 'ashby', board: 'halcyon', status: 'failing', openPostings: 57, lastCheckedAt: iso(0.4), lastError: 'HTTP 404 from the job board' },
  { id: 5, name: 'Corner Store Co', ats: 'none', note: 'posts on its own site; no feed found yet', status: 'unmonitored' },
];

/** In-memory stand-in: everything works for the visit but nothing is saved. */
export class DemoSource implements DataSource {
  kind = 'demo' as const;
  private profile = structuredClone(PROFILE);
  private watches = structuredClone(WATCHES);
  private feedback: Snapshot['feedback'] = {
    a1: { verdict: 'not_for_me', reason: 'too early-stage', at: iso(24 * 5), archivedAt: iso(24 * 3), company: 'Pinecrest Analytics', title: 'Senior Product Manager, Data Platform', url: 'https://example.com/jobs/a1' },
    a2: { verdict: 'interested', at: iso(24 * 50), archivedAt: iso(24 * 45), company: 'Harbor Freightworks', title: 'Lead Product Manager, Logistics', url: 'https://example.com/jobs/a2' },
    // Three passes with the same word in the title: enough for Settings to suggest skipping it.
    a4: { verdict: 'not_for_me', reason: 'too technical', at: iso(24 * 6), archivedAt: iso(24 * 6), company: 'Lumen Grid', title: 'Senior Technical Product Manager, APIs', url: 'https://example.com/jobs/a4' },
    a5: { verdict: 'not_for_me', reason: 'want less technical', at: iso(24 * 9), archivedAt: iso(24 * 9), company: 'Fathom Robotics', title: 'Technical Product Manager, Perception', url: 'https://example.com/jobs/a5' },
    a6: { verdict: 'not_for_me', at: iso(24 * 12), archivedAt: iso(24 * 12), company: 'Quarry Cloud', title: 'Principal Technical Product Manager', url: 'https://example.com/jobs/a6' },
    a3: { at: iso(24 * 70), archivedAt: iso(24 * 70), company: 'Oakline Bank', title: 'Senior Product Manager, Lending', url: 'https://example.com/jobs/a3' },
  };
  private run: Run = { startedAt: iso(0.4), finishedAt: iso(0.39), trigger: 'schedule', errors: 0 };
  private nextId = 100;

  async load(): Promise<Snapshot> {
    return {
      profile: structuredClone(this.profile),
      watches: structuredClone(this.watches),
      matches: MATCHES,
      feedback: { ...this.feedback },
      lastRun: { ...this.run },
      inboxEmails: this.profile.inbox_token ? DEMO_EMAILS : [],
      discoverSources: ['General Catalyst', 'Khosla Ventures', 'Accel', 'Thrive Capital', 'Lux Capital'].map((name) => ({ name, host: '', lastOkAt: iso(2) })),
    };
  }

  async setVerdicts(items: { m: Pick<Match, 'id'>; v: Verdict }[]) {
    for (const { m, v } of items) this.feedback[m.id] = v;
  }

  async setVerdict(m: Pick<Match, 'id'>, v: Verdict | null) {
    if (v) this.feedback[m.id] = v;
    else delete this.feedback[m.id];
  }

  async addWatch(w: NewWatch) {
    if (w.ats !== 'none' && this.watches.some((x) => x.ats === w.ats && x.board === w.board)) throw new Error('Already watching that board');
    this.watches.push({ id: this.nextId++, name: w.name, ats: w.ats, board: w.board, careersUrl: w.careers_url, note: w.note, status: w.ats === 'none' ? 'unmonitored' : 'pending' });
  }

  async changeBoard(id: number, ats: Ats, board: string) {
    Object.assign(this.watches.find((w) => w.id === id)!, { ats, board, status: 'pending', note: undefined, lastError: undefined });
  }

  async removeWatch(id: number) {
    this.watches = this.watches.filter((w) => w.id !== id);
  }

  async setWatchFilters(id: number, filters: Watch['filters'] | null) {
    this.watches.find((w) => w.id === id)!.filters = filters ?? undefined;
  }

  async saveProfile(patch: Partial<Profile>) {
    Object.assign(this.profile, patch);
  }

  async changeEmail(email: string) {
    this.profile.email = email;
  }

  async setInbox(on: boolean) {
    this.profile.inbox_token = on ? 'demo7f3k2q' : null;
    return this.profile.inbox_token;
  }

  async deleteAccount() {
    throw new Error("The demo can't be deleted. Sign up to try it for real.");
  }

  /** Really reads any newly added boards (job boards allow browser requests), so the demo feels real. */
  async requestCheck() {
    const startedAt = new Date().toISOString();
    this.run = { startedAt, trigger: 'check now', errors: 0 };
    const pending = this.watches.filter((w) => w.status === 'pending' && w.ats !== 'none');
    void Promise.all(
      pending.map(async (w) => {
        // Boards the page can't read (only the checker can) are taken on trust in the demo.
        const hit = !pageCanRead(w.ats as Ats) ? { jobs: undefined } : await probeBoard(w.ats as Ats, w.board!);
        Object.assign(w, hit
          ? { status: 'ok', openPostings: hit.jobs, lastCheckedAt: new Date().toISOString(), lastError: undefined }
          : { status: 'failing', lastCheckedAt: new Date().toISOString(), lastError: "Couldn't read that board" });
      }),
    ).then(() => {
      setTimeout(() => (this.run = { ...this.run, finishedAt: new Date().toISOString() }), 2500);
    });
    return startedAt;
  }

  async latestRun() {
    return { ...this.run };
  }
}
