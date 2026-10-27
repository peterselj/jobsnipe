import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Companies from './components/Companies';
import Connect from './components/Connect';
import Matches from './components/Matches';
import { Button, Mark } from './components/ui';
import { DemoSource } from './lib/demo';
import { ago } from './lib/format';
import { addCompany, listCompanies, removeCompany, replaceCompany } from './lib/profileYaml';
import { GitHubSource, type Connection, type DataSource } from './lib/source';
import { load, save } from './lib/storage';
import type { CompanyConfig, Feedback, Match, Verdict, WebView } from './lib/types';

const CONN_KEY = 'jobsnipe.connection';
const VISIT_KEY = 'jobsnipe.lastVisit';
const POLL_MS = 5000;
const CHECK_TIMEOUT_MS = 6 * 60_000;

function savedConnection(): Connection | null {
  try {
    const c = JSON.parse(load(CONN_KEY) ?? 'null');
    return c?.token && c?.repo && c?.profile ? c : null;
  } catch {
    return null;
  }
}

type Check = { state: 'idle' } | { state: 'running'; since: number } | { state: 'failed'; url?: string };

export default function App() {
  const [conn, setConn] = useState<Connection | null>(savedConnection);
  const [demo, setDemo] = useState(() => new URLSearchParams(location.search).has('demo'));
  const source: DataSource | null = useMemo(() => (demo ? new DemoSource() : conn ? new GitHubSource(conn) : null), [demo, conn]);

  if (!source) {
    return (
      <Connect
        onConnect={(c) => {
          save(CONN_KEY, JSON.stringify(c));
          setConn(c);
        }}
        onDemo={() => setDemo(true)}
      />
    );
  }
  return (
    <Dashboard
      key={demo ? 'demo' : conn?.repo}
      source={source}
      onLeave={() => {
        if (demo) setDemo(false);
        else if (confirm('Disconnect this browser? You will need to paste your access key again.')) {
          save(CONN_KEY, null);
          setConn(null);
        }
      }}
    />
  );
}

function Dashboard({ source, onLeave }: { source: DataSource; onLeave: () => void }) {
  const [view, setView] = useState<WebView | null>(null);
  const [profileText, setProfileText] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [, tick] = useState(0);
  // The previous visit, read once: matches first seen after it are "new".
  const lastVisit = useRef<string | undefined>(load(VISIT_KEY) ?? undefined);

  const reload = useCallback(async () => {
    const [v, p, f] = await Promise.all([source.loadView(), source.loadProfile(), source.loadFeedback()]);
    setView(v);
    setProfileText(p);
    setFeedback(f);
  }, [source]);

  useEffect(() => {
    reload()
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    if (source.kind === 'github') save(VISIT_KEY, new Date().toISOString());
    // Keep "checked 12m ago" honest while the page sits open.
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [reload, source]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice((n) => (n === msg ? null : n)), 6000);
  };

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const runCheck = async () => {
    const since = Date.now();
    setCheck({ state: 'running', since });
    setError(null);
    try {
      await source.startCheck();
      while (Date.now() - since < CHECK_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const run = await source.latestRun();
        // Allow for clock skew between this computer and GitHub.
        if (!run || Date.parse(run.createdAt) < since - 15_000 || run.status !== 'completed') continue;
        if (run.conclusion !== 'success') {
          setCheck({ state: 'failed', url: run.url });
          return;
        }
        await reload();
        setCheck({ state: 'idle' });
        flash('Checked every board just now.');
        return;
      }
      setCheck({ state: 'failed' });
    } catch (e) {
      setCheck({ state: 'idle' });
      fail(e);
    }
  };

  const editProfile = async (edit: (t: string) => string, message: string, thenCheck: boolean) => {
    setError(null);
    const next = await source.updateProfile(edit, message);
    setProfileText(next);
    if (thenCheck) void runCheck();
  };

  const onVerdict = async (m: Match, v: Verdict['verdict'] | null, reason?: string) => {
    const prev = feedback;
    const entry: Verdict | null = v ? { verdict: v, reason, at: new Date().toISOString(), company: m.company, title: m.title } : null;
    const optimistic = { ...feedback };
    if (entry) optimistic[m.id] = entry;
    else delete optimistic[m.id];
    setFeedback(optimistic);
    try {
      setFeedback(await source.setVerdict(m.id, entry));
    } catch (e) {
      setFeedback(prev);
      fail(e);
    }
  };

  const companies = useMemo(() => {
    try {
      return profileText ? listCompanies(profileText) : [];
    } catch {
      return [];
    }
  }, [profileText]);

  const health = view?.companies ?? [];
  const failing = health.filter((h) => h.status === 'failing').length;
  const watching = health.filter((h) => h.status === 'ok' || h.status === 'failing').length;
  const lastAt = view?.lastRun?.at;
  const stale = lastAt ? Date.now() - Date.parse(lastAt) > 90 * 60_000 : true;

  return (
    <div className="min-h-screen bg-paper text-ink">
      {source.kind === 'demo' && (
        <div className="bg-forest-deep px-4 py-2 text-center text-[13px] text-white">
          Demo with made-up companies. Changes aren't saved.{' '}
          <button onClick={onLeave} className="font-semibold underline underline-offset-2">Connect your own →</button>
        </div>
      )}

      <header className="border-b border-line-strong bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
          <div className="flex items-center gap-2 text-forest">
            <Mark size={20} />
            <span className="text-base font-extrabold tracking-tight text-ink">JobSnipe</span>
            {view && <span className="text-sm text-muted">· {view.profile.name}</span>}
          </div>
          <div className="text-xs text-ink-soft">
            {lastAt ? (
              <>
                Last check <b className={stale ? 'text-gold' : ''}>{ago(lastAt)}</b>
                <span className="text-muted"> · {watching} boards{failing ? '' : ' OK'}</span>
                {failing > 0 && <span className="font-semibold text-brick"> · {failing} failing</span>}
              </>
            ) : (
              !loading && <span className="text-muted">Not checked yet</span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant={stale ? 'primary' : 'secondary'} onClick={runCheck} disabled={check.state === 'running'}>
              {check.state === 'running' ? <CheckingLabel since={check.since} /> : '↻ Check now'}
            </Button>
            <Button variant="ghost" onClick={onLeave}>{source.kind === 'demo' ? 'Exit demo' : 'Disconnect'}</Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4">
        {check.state === 'running' && (
          <p className="mt-3 text-xs text-muted">Checking every board on GitHub. Usually under a minute; any new match is emailed too.</p>
        )}
        {check.state === 'failed' && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            The check didn't finish.{' '}
            {check.url && <a className="underline" href={check.url} target="_blank" rel="noreferrer">See what happened on GitHub</a>}
          </p>
        )}
        {notice && <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-forest">{notice}</p>}
        {error && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error} <button className="ml-2 underline" onClick={() => setError(null)}>Dismiss</button>
          </p>
        )}
      </div>

      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {loading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <>
            {view ? (
              <Matches matches={view.matches} feedback={feedback} lastVisit={lastVisit.current} onVerdict={onVerdict} />
            ) : (
              <p className="text-sm text-muted">No results yet. Click "Check now" to run the first check.</p>
            )}
            <aside>
              <Companies
                companies={companies}
                health={health}
                onAdd={async (c: CompanyConfig) => {
                  await editProfile((t) => addCompany(t, c), `Add ${c.name} via web`, c.ats !== 'none');
                  flash(c.ats === 'none' ? `Added ${c.name} (not monitored).` : `Added ${c.name}. Checking now; you'll get an email listing any matching roles already open.`);
                }}
                onReplace={async (i, c) => {
                  await editProfile((t) => replaceCompany(t, i, c), `Change ${c.name}'s job board via web`, c.ats !== 'none');
                  flash(`Updated ${c.name}. Checking now.`);
                }}
                onRemove={async (i) => {
                  const name = companies[i]?.name ?? 'company';
                  try {
                    await editProfile((t) => removeCompany(t, i), `Remove ${name} via web`, false);
                    flash(`Stopped watching ${name}.`);
                  } catch (e) {
                    fail(e);
                  }
                }}
              />
            </aside>
          </>
        )}
      </main>
    </div>
  );
}

function CheckingLabel({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.round((Date.now() - since) / 1000);
  return <>Checking… {s}s</>;
}
