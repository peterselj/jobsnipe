import { useState } from 'react';
import { GitHub } from '../lib/github';
import type { Connection } from '../lib/source';
import { Button, Field, Input, Mark } from './ui';

const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';

/** First-visit screen: paste a GitHub key for the private backend repo, or look at the demo. */
export default function Connect({ initial, onConnect, onDemo }: { initial?: Partial<Connection>; onConnect: (c: Connection) => void; onDemo: () => void }) {
  const [token, setToken] = useState(initial?.token ?? '');
  const [repo, setRepo] = useState(initial?.repo ?? 'peterselj/jobsnipe-backend');
  const [profile, setProfile] = useState(initial?.profile ?? 'josh');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const c = { token: token.trim(), repo: repo.trim(), profile: profile.trim() };
    try {
      await new GitHub(c.token, c.repo).check();
      onConnect(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper px-4 py-10 text-ink">
      <div className="mx-auto max-w-xl">
        <div className="flex items-center gap-2 text-forest">
          <Mark size={26} />
          <span className="text-2xl font-extrabold tracking-tight text-ink">JobSnipe</span>
        </div>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-soft">
          JobSnipe checks your target companies' job boards every hour and emails you the moment a role that fits is
          posted, so you can be one of the first applicants.
        </p>

        <div className="mt-6 rounded-xl border border-line-strong bg-white p-5 shadow-sm">
          <h2 className="text-base font-bold">Connect your JobSnipe</h2>
          <p className="mt-1 text-sm text-muted">
            Your matches and settings live in your private GitHub repo. This page reads and edits them with a GitHub
            access key that stays in this browser.
          </p>

          <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-sm text-ink-soft">
            <li>
              Open <a className="font-medium text-forest underline" href={TOKEN_URL} target="_blank" rel="noreferrer">GitHub → new fine-grained token</a>.
            </li>
            <li>Name it "JobSnipe page"; pick an expiration (1 year is fine).</li>
            <li>Repository access: <b>Only select repositories</b> → your backend repo.</li>
            <li>
              Permissions → Repository: <b>Contents</b> = Read and write, <b>Actions</b> = Read and write.
            </li>
            <li>Generate, copy the key, and paste it below.</li>
          </ol>

          <div className="mt-5 space-y-3">
            <Field label="Access key">
              <Input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" onKeyDown={(e) => e.key === 'Enter' && submit()} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px]">
              <Field label="Backend repo">
                <Input value={repo} onChange={(e) => setRepo(e.target.value)} />
              </Field>
              <Field label="Profile">
                <Input value={profile} onChange={(e) => setProfile(e.target.value)} />
              </Field>
            </div>
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button variant="primary" onClick={submit} disabled={busy || !token.trim() || !repo.includes('/')}>
                {busy ? 'Checking…' : 'Connect'}
              </Button>
              <button onClick={onDemo} className="text-sm font-medium text-forest underline-offset-2 hover:underline">
                Just looking? See the demo →
              </button>
            </div>
          </div>
        </div>

        <p className="mt-4 text-xs leading-relaxed text-muted">
          The key is saved only in this browser's storage and sent only to GitHub. Anyone with access to this browser
          profile could use it, so don't connect on a shared computer. You can revoke it any time in GitHub settings.
        </p>
      </div>
    </div>
  );
}
