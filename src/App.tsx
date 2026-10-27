import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Companies from './components/Companies';
import Matches from './components/Matches';
import Settings from './components/Settings';
import SignIn from './components/SignIn';
import { Button, Mark } from './components/ui';
import { DemoSource } from './lib/demo';
import { ago } from '../shared/format';
import { SupabaseSource, type DataSource } from './lib/source';
import { supabase, supabaseConfigured } from './lib/supabase';
import type { Match, Snapshot, Verdict } from './lib/types';

const POLL_MS = 5000;
const CHECK_TIMEOUT_MS = 6 * 60_000;

export default function App() {
  const [demo, setDemo] = useState(() => new URLSearchParams(location.search).has('demo'));
  // undefined while we find out whether this browser is signed in.
  const [session, setSession] = useState<Session | null | undefined>(supabaseConfigured ? undefined : null);

  useEffect(() => {
    if (!supabaseConfigured) return;
    void supabase().auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase().auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  const source: DataSource | null = useMemo(
    () => (demo ? new DemoSource() : userId ? new SupabaseSource(supabase(), userId) : null),
    [demo, userId],
  );

  if (source) {
    return (
      <Dashboard
        key={demo ? 'demo' : userId}
        source={source}
        onLeave={async () => {
          if (demo) {
            history.replaceState(null, '', location.pathname);
            setDemo(false);
          } else {
            await supabase().auth.signOut();
          }
        }}
      />
    );
  }
  if (session === undefined) return <div className="min-h-screen bg-paper" />;
  return <SignIn onDemo={() => setDemo(true)} />;
}

type Check = { state: 'idle' } | { state: 'running'; since: number } | { state: 'failed' };

function Dashboard({ source, onLeave }: { source: DataSource; onLeave: () => void }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [view, setView] = useState<'matches' | 'settings'>('matches');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const [, tick] = useState(0);

  const reload = useCallback(async () => setSnap(await source.load()), [source]);
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  useEffect(() => {
    reload().catch(fail);
    // Keep "checked 12m ago" honest while the page sits open.
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [reload]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice((n) => (n === msg ? null : n)), 7000);
  };

  /** Ask for a check and wait for it to finish, then reload. */
  const runCheck = async (doneMessage = 'Checked every board just now.') => {
    setError(null);
    const started = Date.now();
    try {
      const since = Date.parse(await source.requestCheck());
      setCheck({ state: 'running', since: started });
      while (Date.now() - started < CHECK_TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const run = await source.latestRun();
        // A few seconds' grace for clock differences between this computer and the server.
        if (run?.finishedAt && Date.parse(run.startedAt) >= since - 5000) {
          await reload();
          setCheck({ state: 'idle' });
          flash(doneMessage);
          return;
        }
      }
      setCheck({ state: 'failed' });
    } catch (e) {
      setCheck({ state: 'idle' });
      fail(e);
    }
  };

  /** Save a role's new state: a decision, archived, or null (back to the inbox). */
  const onVerdict = async (m: Match, entry: Verdict | null) => {
    if (!snap) return;
    const prev = snap.feedback;
    const next = { ...prev };
    if (entry) next[m.id] = entry;
    else delete next[m.id];
    setSnap({ ...snap, feedback: next }); // instant; undone below if the save fails
    try {
      await source.setVerdict(m, entry);
    } catch (e) {
      setSnap((s) => (s ? { ...s, feedback: prev } : s));
      fail(e);
    }
  };

  if (!snap) {
    return (
      <div className="min-h-screen bg-paper px-4 py-10 text-sm text-muted">
        {error ? <p className="mx-auto max-w-xl rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p> : <p className="mx-auto max-w-xl">Loading…</p>}
      </div>
    );
  }

  const failing = snap.watches.filter((w) => w.status === 'failing').length;
  const boards = snap.watches.filter((w) => w.status !== 'unmonitored').length;
  const lastAt = snap.lastRun?.startedAt;
  const stale = lastAt ? Date.now() - Date.parse(lastAt) > 90 * 60_000 : true;
  const needsFilters = !snap.profile.criteria.titles?.include?.length;

  return (
    <div className="min-h-screen bg-paper text-ink">
      {source.kind === 'demo' && (
        <div className="bg-forest-deep px-4 py-2 text-center text-[13px] text-white">
          Demo with made-up companies. Nothing is saved.{' '}
          <button onClick={onLeave} className="font-semibold underline underline-offset-2">Sign up →</button>
        </div>
      )}

      <header className="border-b border-line-strong bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
          <button onClick={() => setView('matches')} className="flex items-center gap-2 text-forest">
            <Mark size={20} />
            <span className="text-base font-extrabold tracking-tight text-ink">JobSnipe</span>
          </button>
          <div className="text-xs text-ink-soft">
            {lastAt ? (
              <>
                Last check <b className={stale ? 'text-gold' : ''}>{ago(lastAt)}</b>
                <span className="text-muted"> · {boards} boards{failing ? '' : ' OK'}</span>
                {failing > 0 && <span className="font-semibold text-brick"> · {failing} failing</span>}
              </>
            ) : (
              <span className="text-muted">Not checked yet</span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant={stale ? 'primary' : 'secondary'} onClick={() => runCheck()} disabled={check.state === 'running'}>
              {check.state === 'running' ? <CheckingLabel since={check.since} /> : '↻ Check now'}
            </Button>
            <Button variant="ghost" onClick={() => setView(view === 'settings' ? 'matches' : 'settings')}>
              {view === 'settings' ? '← Matches' : 'Settings'}
            </Button>
            <Button variant="ghost" onClick={onLeave} title={source.kind === 'demo' ? undefined : snap.profile.email}>
              {source.kind === 'demo' ? 'Exit demo' : 'Sign out'}
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4">
        {check.state === 'running' && <p className="mt-3 text-xs text-muted">Checking every board. Usually about a minute; any new match is emailed too.</p>}
        {check.state === 'failed' && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">The check didn't finish. The hourly check will try again.</p>}
        {snap.profile.alerts_paused && (
          <p className="mt-3 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Email alerts are paused. Your inbox here still updates.
            <button
              className="font-semibold underline underline-offset-2"
              onClick={async () => {
                try {
                  await source.saveProfile({ alerts_paused: false });
                  await reload();
                  flash('Alerts are back on.');
                } catch (e) {
                  fail(e);
                }
              }}
            >
              Resume
            </button>
          </p>
        )}
        {notice && <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-forest">{notice}</p>}
        {error && (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {error} <button className="ml-2 underline" onClick={() => setError(null)}>Dismiss</button>
          </p>
        )}
      </div>

      {view === 'settings' ? (
        <main className="px-4 py-6">
          <Settings
            profile={snap.profile}
            nearMisses={snap.matches.filter((m) => m.nearMiss)}
            onPause={async (paused) => {
              await source.saveProfile({ alerts_paused: paused });
              await reload(); // the banner and the card show the new state
            }}
            onDelete={async () => {
              await source.deleteAccount();
              onLeave();
            }}
            onCancel={() => setView('matches')}
            onSave={async (patch) => {
              await source.saveProfile(patch);
              await reload();
              setView('matches');
              void runCheck('Re-checked with your new filters.');
            }}
          />
        </main>
      ) : (
        <main className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Matches
            matches={snap.matches}
            feedback={snap.feedback}
            onVerdict={onVerdict}
            needsFilters={needsFilters}
            onOpenSettings={() => setView('settings')}
          />
          <aside>
            <Companies
              watches={snap.watches}
              criteria={snap.profile.criteria}
              onSetFilters={async (w, filters) => {
                await source.setWatchFilters(w.id, filters);
                await reload();
                void runCheck(`${w.name}'s filters are applied.`);
              }}
              onAdd={async (w) => {
                await source.addWatch(w);
                await reload();
                if (w.ats === 'none') return flash(`Added ${w.name} (not monitored).`);
                flash(`Added ${w.name}. Checking it now; you'll get an email listing any matching roles already open.`);
                void runCheck(`${w.name} is checked and watched hourly from now on.`);
              }}
              onChangeBoard={async (w, ats, board) => {
                await source.changeBoard(w.id, ats, board);
                await reload();
                void runCheck(`${w.name}'s new board is checked.`);
              }}
              onRemove={async (w) => {
                try {
                  await source.removeWatch(w.id);
                  await reload();
                  flash(`Stopped watching ${w.name}.`);
                } catch (e) {
                  fail(e);
                }
              }}
            />
          </aside>
        </main>
      )}
    </div>
  );
}

function CheckingLabel({ since }: { since: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <>Checking… {Math.round((Date.now() - since) / 1000)}s</>;
}
