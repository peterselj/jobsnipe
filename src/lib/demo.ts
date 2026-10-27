import { probeBoard } from './ats';
import type { DataSource } from './source';
import type { Ats, Match, NewWatch, Profile, Run, Snapshot, Verdict, Watch } from './types';

// Fictional companies and roles, so the public demo never shows anyone's real search.

const H = 3_600_000;
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * H).toISOString();

const PROFILE: Profile = {
  id: 'demo',
  name: 'Demo',
  email: 'demo@example.com',
  alert_mode: 'immediate',
  criteria: {
    titles: { include: ['product manager', 'head of product'], exclude: ['product marketing', 'intern'] },
    seniority: { require: ['senior', 'staff', 'principal', 'lead', 'group', 'director', 'head'], unlevelled_pay_min: 180000 },
    locations: [{ name: 'NYC area', match: ['new york', 'nyc', 'brooklyn'] }, { name: 'Toronto area', match: ['toronto', 'ontario'] }],
    remote: { allowed: true, countries: ['US', 'CA'] },
    comp_floor: { USD: 140000, CAD: 140000 },
  },
};

const MATCHES: Match[] = [
  { id: 'd1', company: 'Northwind Media', title: 'Senior Product Manager, Subscriptions', url: 'https://example.com/jobs/1', where: 'NYC area', flags: [], comp: { min: 175000, max: 210000, currency: 'USD' }, atsPostedAt: iso(1.5), firstSeenAt: iso(0.4) },
  { id: 'd2', company: 'Fieldline Robotics', title: 'Lead Product Manager, Fleet Platform', url: 'https://example.com/jobs/2', where: 'Toronto area', flags: [], comp: { min: 165000, max: 220000, currency: 'CAD' }, atsPostedAt: iso(20), firstSeenAt: iso(19) },
  { id: 'd3', company: 'Brightpath', title: 'Staff Product Manager, Growth', url: 'https://example.com/jobs/3', where: 'Remote (US)', flags: ['no pay range listed'], atsPostedAt: iso(70), firstSeenAt: iso(69) },
  { id: 'd4', company: 'Halcyon AI', title: 'Product Manager, Developer Platform', url: 'https://example.com/jobs/4', where: 'NYC area', flags: ['no level in title; pay suggests senior'], comp: { min: 240000, max: 300000, currency: 'USD' }, atsPostedAt: iso(150), firstSeenAt: iso(140) },
  { id: 'd5', company: 'Northwind Media', title: 'Group Product Manager, Ads', url: 'https://example.com/jobs/5', where: 'Remote (scope unclear)', flags: ["remote, but the allowed countries aren't stated"], comp: { min: 210000, max: 250000, currency: 'USD' }, atsPostedAt: iso(400), firstSeenAt: iso(390) },
];

const WATCHES: Watch[] = [
  { id: 1, name: 'Northwind Media', ats: 'greenhouse', board: 'northwind', status: 'ok', openPostings: 84, lastCheckedAt: iso(0.4) },
  { id: 2, name: 'Fieldline Robotics', ats: 'lever', board: 'fieldline', status: 'ok', openPostings: 31, lastCheckedAt: iso(0.4) },
  { id: 3, name: 'Brightpath', ats: 'ashby', board: 'brightpath', status: 'ok', openPostings: 22, lastCheckedAt: iso(0.4) },
  { id: 4, name: 'Halcyon AI', ats: 'ashby', board: 'halcyon', status: 'failing', openPostings: 57, lastCheckedAt: iso(0.4), lastError: 'HTTP 404 from the job board' },
  { id: 5, name: 'Corner Store Co', ats: 'none', note: 'posts on its own site; no feed found yet', status: 'unmonitored' },
];

/** In-memory stand-in: everything works for the visit but nothing is saved. */
export class DemoSource implements DataSource {
  kind = 'demo' as const;
  private profile = structuredClone(PROFILE);
  private watches = structuredClone(WATCHES);
  private feedback: Snapshot['feedback'] = {};
  private run: Run = { startedAt: iso(0.4), finishedAt: iso(0.39), trigger: 'schedule', errors: 0 };
  private nextId = 100;

  async load(): Promise<Snapshot> {
    return {
      profile: structuredClone(this.profile),
      watches: structuredClone(this.watches),
      matches: MATCHES,
      feedback: { ...this.feedback },
      lastRun: { ...this.run },
    };
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

  async saveProfile(patch: Partial<Profile>) {
    Object.assign(this.profile, patch);
  }

  /** Really reads any newly added boards (job boards allow browser requests), so the demo feels real. */
  async requestCheck() {
    const startedAt = new Date().toISOString();
    this.run = { startedAt, trigger: 'check now', errors: 0 };
    const pending = this.watches.filter((w) => w.status === 'pending' && w.ats !== 'none');
    void Promise.all(
      pending.map(async (w) => {
        const hit = await probeBoard(w.ats as Ats, w.board!);
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
