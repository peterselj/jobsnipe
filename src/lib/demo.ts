import type { DataSource } from './source';
import type { Feedback, RunStatus, Verdict, WebView } from './types';

// Fictional companies and roles, so the public demo never shows anyone's real search.

const H = 3_600_000;
const iso = (hoursAgo: number) => new Date(Date.now() - hoursAgo * H).toISOString();

function demoView(): WebView {
  return {
    version: 1,
    profile: { id: 'demo', name: 'Demo' },
    generatedAt: iso(0.4),
    lastRun: { at: iso(0.4), newPostings: 3, alertsSent: 1, errors: 0 },
    matches: [
      { id: 'd1', company: 'Northwind Media', title: 'Senior Product Manager, Subscriptions', url: 'https://example.com/jobs/1', where: 'NYC area', flags: [], comp: { min: 175000, max: 210000, currency: 'USD' }, atsPostedAt: iso(1.5), firstSeenAt: iso(0.4), alertedAt: iso(0.4) },
      { id: 'd2', company: 'Fieldline Robotics', title: 'Lead Product Manager, Fleet Platform', url: 'https://example.com/jobs/2', where: 'Toronto area', flags: [], comp: { min: 165000, max: 220000, currency: 'CAD' }, atsPostedAt: iso(20), firstSeenAt: iso(19) },
      { id: 'd3', company: 'Brightpath', title: 'Staff Product Manager, Growth', url: 'https://example.com/jobs/3', where: 'Remote (US)', flags: ['no pay range listed'], atsPostedAt: iso(70), firstSeenAt: iso(69) },
      { id: 'd4', company: 'Halcyon AI', title: 'Product Manager, Developer Platform', url: 'https://example.com/jobs/4', where: 'NYC area', flags: ['no level in title; pay suggests senior'], comp: { min: 240000, max: 300000, currency: 'USD' }, atsPostedAt: iso(150), firstSeenAt: iso(140) },
      { id: 'd5', company: 'Northwind Media', title: 'Group Product Manager, Ads', url: 'https://example.com/jobs/5', where: 'Remote (scope unclear)', flags: ["remote, but the allowed countries aren't stated"], comp: { min: 210000, max: 250000, currency: 'USD' }, atsPostedAt: iso(400), firstSeenAt: iso(390) },
    ],
    companies: [
      { name: 'Northwind Media', ats: 'greenhouse', board: 'northwind', boardUrl: 'https://example.com', status: 'ok', openPostings: 84, lastCheckedAt: iso(0.4), lastOkAt: iso(0.4) },
      { name: 'Fieldline Robotics', ats: 'lever', board: 'fieldline', boardUrl: 'https://example.com', status: 'ok', openPostings: 31, lastCheckedAt: iso(0.4), lastOkAt: iso(0.4) },
      { name: 'Brightpath', ats: 'ashby', board: 'brightpath', boardUrl: 'https://example.com', status: 'ok', openPostings: 22, lastCheckedAt: iso(0.4), lastOkAt: iso(0.4) },
      { name: 'Halcyon AI', ats: 'ashby', board: 'halcyon', boardUrl: 'https://example.com', status: 'failing', openPostings: 57, lastCheckedAt: iso(0.4), lastOkAt: iso(3.4), lastError: 'HTTP 404 from the job board' },
      { name: 'Corner Store Co', ats: 'none', note: 'posts on its own site; no feed found yet', status: 'unmonitored' },
    ],
  };
}

const DEMO_PROFILE = `id: demo
name: Demo
companies:
  - { name: Northwind Media, ats: greenhouse, board: northwind }
  - { name: Fieldline Robotics, ats: lever, board: fieldline }
  - { name: Brightpath, ats: ashby, board: brightpath }
  - { name: Halcyon AI, ats: ashby, board: halcyon }
  - name: Corner Store Co
    ats: none
    note: posts on its own site; no feed found yet
`;

/** In-memory stand-in: edits and feedback work for the session but go nowhere. */
export class DemoSource implements DataSource {
  kind = 'demo' as const;
  private profile = DEMO_PROFILE;
  private feedback: Feedback = {};
  private run: RunStatus = { status: 'completed', conclusion: 'success', createdAt: iso(0.4), url: '#' };
  private view = demoView();

  async loadView() {
    return this.view;
  }
  async loadProfile() {
    return this.profile;
  }
  async updateProfile(edit: (t: string) => string) {
    this.profile = edit(this.profile);
    return this.profile;
  }
  async loadFeedback() {
    return { ...this.feedback };
  }
  async setVerdict(id: string, v: Verdict | null) {
    if (v) this.feedback[id] = v;
    else delete this.feedback[id];
    return { ...this.feedback };
  }
  async startCheck() {
    const createdAt = new Date().toISOString();
    this.run = { status: 'in_progress', createdAt, url: '#' };
    setTimeout(() => {
      this.run = { status: 'completed', conclusion: 'success', createdAt, url: '#' };
      this.view = { ...this.view, generatedAt: new Date().toISOString(), lastRun: { at: createdAt, newPostings: 0, alertsSent: 0, errors: 0 } };
    }, 4000);
  }
  async latestRun() {
    return this.run;
  }
}
