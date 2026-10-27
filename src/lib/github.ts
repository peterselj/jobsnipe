import type { RunStatus } from './types';

const API = 'https://api.github.com';

export class GitHubError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** The few GitHub REST calls JobSnipe needs, authenticated with a fine-grained token. */
export class GitHub {
  constructor(private token: string, public repo: string, private fetchImpl: typeof fetch = fetch.bind(globalThis)) {}

  private async req(path: string, init: RequestInit = {}, accept = 'application/vnd.github+json'): Promise<Response> {
    const res = await this.fetchImpl(`${API}/repos/${this.repo}${path}`, {
      ...init,
      cache: 'no-store',
      headers: {
        Accept: accept,
        Authorization: `Bearer ${this.token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (!res.ok && res.status !== 404) {
      const body = await res.json().catch(() => ({}));
      const hint =
        res.status === 401 ? 'The access key is invalid or expired.'
        : res.status === 403 ? 'The access key is missing a permission.'
        : '';
      throw new GitHubError(res.status, `${hint} GitHub said: ${body.message ?? res.statusText}`.trim());
    }
    return res;
  }

  /** Confirms the token can see the repo; returns its default branch. */
  async check(): Promise<string> {
    const res = await this.req('');
    if (res.status === 404) throw new GitHubError(404, `Can't see ${this.repo}. Check the name, and that the key includes this repo.`);
    return (await res.json()).default_branch;
  }

  /** File text, or null if it doesn't exist. Uses the raw media type so files over 1 MB work. */
  async readText(path: string, ref: string): Promise<string | null> {
    const res = await this.req(`/contents/${path}?ref=${encodeURIComponent(ref)}`, {}, 'application/vnd.github.raw+json');
    return res.status === 404 ? null : res.text();
  }

  /** File text plus the sha needed to update it. */
  async readFile(path: string, ref: string): Promise<{ text: string; sha: string } | null> {
    const res = await this.req(`/contents/${path}?ref=${encodeURIComponent(ref)}`);
    if (res.status === 404) return null;
    const j = await res.json();
    return { text: fromBase64(j.content), sha: j.sha };
  }

  /** Create or update a file in one commit; returns the new file sha. */
  async writeFile(path: string, text: string, message: string, branch: string, sha?: string): Promise<string> {
    const res = await this.req(`/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({ message, content: toBase64(text), branch, ...(sha ? { sha } : {}) }),
    });
    if (res.status === 404) throw new GitHubError(404, `Branch "${branch}" not found in ${this.repo}.`);
    return (await res.json()).content.sha;
  }

  async branchExists(branch: string): Promise<boolean> {
    return (await this.req(`/git/ref/heads/${encodeURIComponent(branch)}`)).status !== 404;
  }

  /** Make `branch` pointing at the tip of `from`. */
  async createBranch(branch: string, from: string): Promise<void> {
    const ref = await (await this.req(`/git/ref/heads/${encodeURIComponent(from)}`)).json();
    await this.req('/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object.sha }) });
  }

  async runWorkflow(file: string, ref: string): Promise<void> {
    const res = await this.req(`/actions/workflows/${file}/dispatches`, { method: 'POST', body: JSON.stringify({ ref }) });
    if (res.status === 404) throw new GitHubError(404, `Workflow ${file} not found in ${this.repo}.`);
  }

  async latestRun(file: string): Promise<RunStatus | null> {
    const res = await this.req(`/actions/workflows/${file}/runs?per_page=1`);
    if (res.status === 404) return null;
    const run = (await res.json()).workflow_runs?.[0];
    return run ? { status: run.status, conclusion: run.conclusion, createdAt: run.created_at, url: run.html_url } : null;
  }
}
