import { GitHub } from './github';
import type { Feedback, RunStatus, Verdict, WebView } from './types';

/** Everything the page reads and writes. GitHubSource is the real one; DemoSource backs the demo. */
export interface DataSource {
  kind: 'github' | 'demo';
  loadView(): Promise<WebView | null>;
  loadProfile(): Promise<string>;
  /** Re-reads the profile file, applies `edit`, and commits the result. */
  updateProfile(edit: (text: string) => string, message: string): Promise<string>;
  loadFeedback(): Promise<Feedback>;
  /** Set or clear (null) one verdict; returns the saved feedback. */
  setVerdict(postingId: string, v: Verdict | null): Promise<Feedback>;
  startCheck(): Promise<void>;
  latestRun(): Promise<RunStatus | null>;
}

export interface Connection {
  token: string;
  repo: string; // owner/name of the private backend repo
  profile: string; // profiles/<profile>.yaml
}

const WORKFLOW = 'fast-lane.yml';
const STATE_BRANCH = 'state';
const FEEDBACK_BRANCH = 'feedback';

export class GitHubSource implements DataSource {
  kind = 'github' as const;
  private gh: GitHub;
  private main?: Promise<string>;
  // One write at a time, so two quick clicks can't race on the same file.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private conn: Connection, fetchImpl?: typeof fetch) {
    this.gh = new GitHub(conn.token, conn.repo, fetchImpl);
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => {});
    return next;
  }

  /** Cached as a promise so parallel first loads share one request. */
  private mainBranch(): Promise<string> {
    this.main ??= this.gh.check();
    this.main.catch(() => (this.main = undefined));
    return this.main;
  }

  private get profilePath() {
    return `profiles/${this.conn.profile}.yaml`;
  }

  private get feedbackPath() {
    return `feedback/${this.conn.profile}.json`;
  }

  async loadView(): Promise<WebView | null> {
    await this.mainBranch();
    const text = await this.gh.readText(`web/${this.conn.profile}.json`, STATE_BRANCH);
    return text ? (JSON.parse(text) as WebView) : null;
  }

  async loadProfile(): Promise<string> {
    const f = await this.gh.readFile(this.profilePath, await this.mainBranch());
    if (!f) throw new Error(`No ${this.profilePath} in ${this.conn.repo}.`);
    return f.text;
  }

  updateProfile(edit: (text: string) => string, message: string): Promise<string> {
    return this.serial(async () => {
      const branch = await this.mainBranch();
      const f = await this.gh.readFile(this.profilePath, branch);
      if (!f) throw new Error(`No ${this.profilePath} in ${this.conn.repo}.`);
      const next = edit(f.text);
      await this.gh.writeFile(this.profilePath, next, message, branch, f.sha);
      return next;
    });
  }

  async loadFeedback(): Promise<Feedback> {
    const f = await this.gh.readFile(this.feedbackPath, FEEDBACK_BRANCH);
    return f ? (JSON.parse(f.text) as Feedback) : {};
  }

  setVerdict(postingId: string, v: Verdict | null): Promise<Feedback> {
    return this.serial(async () => {
      if (!(await this.gh.branchExists(FEEDBACK_BRANCH))) {
        await this.gh.createBranch(FEEDBACK_BRANCH, await this.mainBranch());
      }
      const f = await this.gh.readFile(this.feedbackPath, FEEDBACK_BRANCH);
      const fb: Feedback = f ? JSON.parse(f.text) : {};
      if (v) fb[postingId] = v;
      else delete fb[postingId];
      const label = v ? `${v.verdict === 'interested' ? 'Interested' : 'Not for me'}: ${v.title} at ${v.company}` : `Clear feedback on ${postingId}`;
      await this.gh.writeFile(this.feedbackPath, JSON.stringify(fb, null, 1) + '\n', label, FEEDBACK_BRANCH, f?.sha);
      return fb;
    });
  }

  async startCheck(): Promise<void> {
    await this.gh.runWorkflow(WORKFLOW, await this.mainBranch());
  }

  latestRun(): Promise<RunStatus | null> {
    return this.gh.latestRun(WORKFLOW);
  }
}
