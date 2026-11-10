import { useState } from 'react';
import { linkOwner } from '../../shared/ats';
import { safeHttpUrl } from '../../shared/url';
import { ago, money } from '../../shared/format';
import { isManual } from '../lib/addRole';
import { postingDescription, postingForResume, resumeMachineLink } from '../lib/posting';
import type { DigestEvery, DiscoverSource, Feedback, Match, NewWatch, Verdict } from '../lib/types';
import FindBoard from './FindBoard';
import { Button } from './ui';

type Folder = 'inbox' | 'interested' | 'not_for_me' | 'near' | 'discover' | 'archive';

const DIGEST_LABEL: Record<DigestEvery, string> = { daily: 'a daily', weekly: 'a weekly', biweekly: 'a fortnightly', never: 'no' };
type MissCheck = NonNullable<Match['nearMiss']>;

export const MISS_LABEL: Record<MissCheck, string> = { pay: 'Pay', location: 'Place', seniority: 'Level', age: 'Age' };

interface Props {
  matches: Match[];
  feedback: Feedback;
  /** Save a role's new state: a decision, archived, or null (back to the inbox). */
  onVerdict: (m: Match, entry: Verdict | null) => void;
  onVerdicts: (items: { m: Match; v: Verdict }[]) => void;
  /** Shown in the inbox when there's nothing to triage because no filters are set. */
  needsFilters?: boolean;
  onOpenSettings?: () => void;
  /** Discover: start watching a company found there. */
  onWatch: (c: NewWatch) => Promise<void>;
  discoverSources: DiscoverSource[];
  digestEvery: DigestEvery;
}

const DAY = 86_400_000;

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const JOB_SITES = new Set(['linkedin', 'indeed', 'wellfound', 'angel', 'glassdoor', 'ziprecruiter']);

/** When a VC board files a job under one company but its link goes to another (e.g. one that bought it). */
function linksElsewhere(m: Match): string | undefined {
  const owner = m.url ? linkOwner(m.url) : undefined;
  // Job sites (where alert emails link) aren't the employer, so a mismatch there means nothing.
  if (!owner || JOB_SITES.has(owner)) return undefined;
  const a = squash(owner);
  const b = squash(m.company);
  return a && b && !a.includes(b) && !b.includes(a) ? owner : undefined;
}

/** The filter bar: place, minimum pay (in thousands, or a full number), keywords (-word hides). */
function passes(f: { place: string; minPay: string; keyword: string; payOnly: boolean }) {
  const n = Number(f.minPay.replace(/[^\d.]/g, ''));
  const floor = n ? (n < 1000 ? n * 1000 : n) : 0;
  const words = f.keyword.toLowerCase().split(/\s+/).filter(Boolean);
  return (m: Match) => {
    if (f.place === 'Remote*' ? !m.where?.startsWith('Remote') : f.place && m.where !== f.place) return false;
    if (f.payOnly && !m.comp) return false;
    if (floor && m.comp && m.comp.max < floor) return false;
    const text = `${m.title} ${m.company}`.toLowerCase();
    return words.every((w) => (w.startsWith('-') ? w.length === 1 || !text.includes(w.slice(1)) : text.includes(w)));
  };
}
/** The Archive shows roles archived this recently; older ones fold away behind "Show older". */
const ARCHIVE_RECENT_DAYS = 30;

/**
 * Matches as an inbox: everything not yet decided sits in Inbox until marked Interested or Not for
 * me, or archived. Done with a role? Archive it; the Archive keeps it (and what you thought of it) for
 * good, so it never comes back. Decided and archived roles are read from the saved verdicts, so
 * they stay listed after the posting closes.
 */
export default function Matches({ matches, feedback, onVerdict, onVerdicts, needsFilters, onOpenSettings, onWatch, discoverSources, digestEvery }: Props) {
  const [folder, setFolder] = useState<Folder>('inbox');
  const [missFilter, setMissFilter] = useState<MissCheck | null>(null);
  const [viaFilter, setViaFilter] = useState<string | null>(null);
  const [showOlder, setShowOlder] = useState(false);
  const open = new Map(matches.map((m) => [m.id, m]));

  // Inbox: new matches on your list, including roles from your job-alert emails at companies on your
  // list that JobSnipe can't check directly.
  const inbox = matches.filter((m) => !m.nearMiss && (!m.via || m.onList) && !feedback[m.id]);
  // Near misses: right job family, missed by one filter. Marking one Interested moves it to Interested.
  const near = matches.filter((m) => m.nearMiss && !feedback[m.id]);
  // Discover: the opposite of a near miss. Every filter passes, but the company isn't on your list.
  const discover = matches.filter((m) => m.via && !m.onList && !feedback[m.id]);
  const viaCounts = new Map<string, number>();
  for (const m of discover) for (const v of m.via!) viaCounts.set(v, (viaCounts.get(v) ?? 0) + 1);
  const missCounts = near.reduce<Partial<Record<MissCheck, number>>>((acc, m) => ({ ...acc, [m.nearMiss!]: (acc[m.nearMiss!] ?? 0) + 1 }), {});
  const fromVerdicts = (keep: (f: Verdict) => boolean, newestBy: (f: Verdict) => string) =>
    Object.entries(feedback)
      .filter(([, f]) => keep(f))
      .sort(([, a], [, b]) => newestBy(b).localeCompare(newestBy(a)))
      .map(([id, f]) => open.get(id) ?? { id, company: f.company, title: f.title, url: f.url ?? '', flags: [], firstSeenAt: f.at, closed: true });
  const lists: Record<Folder, (Match & { closed?: boolean })[]> = {
    inbox,
    interested: fromVerdicts((f) => f.verdict === 'interested' && !f.archivedAt, (f) => f.at),
    not_for_me: fromVerdicts((f) => f.verdict === 'not_for_me' && !f.archivedAt, (f) => f.at),
    near: missFilter ? near.filter((m) => m.nearMiss === missFilter) : near,
    discover: viaFilter ? discover.filter((m) => m.via!.includes(viaFilter)) : discover,
    archive: [],
  };
  // The Archive shows the last month; older roles fold away behind "Show older". Deleted ones are gone
  // from every list (but stay remembered, so they never come back to the inbox).
  const archived = fromVerdicts((f) => !!f.archivedAt && !f.deletedAt, (f) => f.archivedAt!);
  const recentCutoff = Date.now() - ARCHIVE_RECENT_DAYS * DAY;
  const olderCount = archived.filter((m) => Date.parse(feedback[m.id].archivedAt!) < recentCutoff).length;
  lists.archive = showOlder ? archived : archived.filter((m) => Date.parse(feedback[m.id].archivedAt!) >= recentCutoff);
  // Filters on what's in front of you (not the Archive): place, minimum pay, keywords.
  const [place, setPlace] = useState('');
  const [minPay, setMinPay] = useState('');
  const [keyword, setKeyword] = useState('');
  const [payOnly, setPayOnly] = useState(false);
  const filtering = folder !== 'archive';
  const all = lists[folder];
  const shown = filtering ? all.filter(passes({ place, minPay, keyword, payOnly })) : all;
  const places = [...new Set(all.map((m) => m.where).filter((w): w is string => !!w))].sort();
  const active = filtering && !!(place || minPay.trim() || keyword.trim() || payOnly);

  const emptyArchive = () => {
    if (!confirm(`Delete all ${archived.length} archived roles? They're gone for good, and still never come back to your inbox.`)) return;
    const at = new Date().toISOString();
    onVerdicts(archived.map((m) => ({ m, v: { ...feedback[m.id], deletedAt: at } })));
  };

  // Archive everything in the current view, keeping each role's decision.
  const archiveAll = () => {
    const where =
      tabs.find((t) => t.key === folder)!.label.replace('★ ', '') +
      (folder === 'near' && missFilter ? ` (${MISS_LABEL[missFilter]})` : '') +
      (folder === 'discover' && viaFilter ? ` (via ${viaFilter})` : '') +
      (active ? ' that match your filters' : '');
    if (!confirm(`Archive all ${shown.length} roles in ${where}? You can restore any of them from the Archive.`)) return;
    const at = new Date().toISOString();
    onVerdicts(
      shown.map((m) => {
        const v = feedback[m.id];
        return { m, v: v ? { ...v, archivedAt: at } : { at, company: m.company, title: m.title, url: m.url, archivedAt: at } };
      }),
    );
  };

  const tabs: { key: Folder; label: string }[] = [
    { key: 'inbox', label: 'Inbox' },
    { key: 'interested', label: '★ Interested' },
    { key: 'not_for_me', label: 'Not for me' },
    { key: 'near', label: 'Near misses' },
    { key: 'discover', label: 'Discover' },
    { key: 'archive', label: 'Archive' },
  ];

  return (
    <section>
      <div className="mb-3 flex items-center gap-1 overflow-x-auto border-b border-line-strong [scrollbar-width:none]" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={folder === t.key}
            onClick={() => setFolder(t.key)}
            className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
              folder === t.key ? 'border-forest text-ink' : 'border-transparent text-muted hover:text-ink-soft'
            }`}
          >
            {t.label}
            <span className={`rounded-full px-1.5 py-px font-mono text-[10px] ${t.key === 'inbox' && inbox.length ? 'bg-forest text-white' : 'bg-slate-200 text-ink-soft'}`}>
              {t.key === 'near' ? near.length : t.key === 'discover' ? discover.length : t.key === 'archive' ? archived.length : lists[t.key].length}
            </span>
          </button>
        ))}
      </div>

      {folder === 'near' && near.length > 0 && (
        <div className="mb-3 rounded-xl border border-line bg-white px-4 py-3">
          <p className="text-sm text-ink-soft">
            Roles in your job family that your filters hid for <b>one</b> reason. Never emailed. If a pattern shows up, adjust
            that filter in{' '}
            {onOpenSettings ? <button className="font-semibold text-forest underline-offset-2 hover:underline" onClick={onOpenSettings}>Settings</button> : 'Settings'}.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {([null, 'pay', 'location', 'seniority', 'age'] as (MissCheck | null)[]).map((k) =>
              k && !missCounts[k] ? null : (
                <button
                  key={k ?? 'all'}
                  onClick={() => setMissFilter(k)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${missFilter === k ? 'border-forest bg-emerald-50 text-forest' : 'border-line-strong text-ink-soft hover:bg-paper'}`}
                >
                  {k ? `${MISS_LABEL[k]} · ${missCounts[k]}` : `All · ${near.length}`}
                </button>
              ),
            )}
          </div>
        </div>
      )}

      {filtering && all.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <select
            aria-label="Place"
            value={place}
            onChange={(e) => setPlace(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-emerald-600 focus:outline-none"
          >
            <option value="">All places</option>
            {places.some((p) => p.startsWith('Remote')) && <option value="Remote*">All remote</option>}
            {places.map((p) => (
              <option key={p} value={p}>{p} · {all.filter((m) => m.where === p).length}</option>
            ))}
          </select>
          <input
            aria-label="Minimum pay in thousands"
            inputMode="numeric"
            value={minPay}
            onChange={(e) => setMinPay(e.target.value)}
            placeholder="Min pay ($K)"
            className="w-28 rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-emerald-600 focus:outline-none"
          />
          <input
            aria-label="Keywords"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="Keywords (-word to hide)"
            className="min-w-0 flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm focus:border-emerald-600 focus:outline-none sm:max-w-[240px]"
          />
          <label className="flex items-center gap-1.5 text-ink-soft">
            <input type="checkbox" checked={payOnly} onChange={(e) => setPayOnly(e.target.checked)} className="h-4 w-4 accent-[var(--color-forest)]" />
            Pay listed
          </label>
          {active && (
            <span className="text-xs text-muted">
              Showing {shown.length} of {all.length} ·{' '}
              <button className="font-semibold text-forest underline-offset-2 hover:underline" onClick={() => { setPlace(''); setMinPay(''); setKeyword(''); setPayOnly(false); }}>
                Clear
              </button>
            </span>
          )}
        </div>
      )}

      {folder === 'discover' && (
        <div className="mb-3 rounded-xl border border-line bg-white px-4 py-3">
          <p className="text-sm text-ink-soft">
            Roles that pass <b>all</b> your filters at companies you don't watch, from VC portfolio job boards
            {discoverSources.length ? ` (${discoverSources.map((s) => s.name).join(', ')})` : ''}
            {discover.some((m) => m.via!.some((v) => v.endsWith(' alert'))) ? ' and your job-alert emails' : ''}. Checked every 4 hours and sent as{' '}
            {DIGEST_LABEL[digestEvery]} digest email (
            {onOpenSettings ? <button className="font-semibold text-forest underline-offset-2 hover:underline" onClick={onOpenSettings}>change</button> : 'change in Settings'}
            ). Like a company? <b>Watch it</b> to hear about its new roles within the hour.
          </p>
          {viaCounts.size > 1 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {[null, ...[...viaCounts.keys()].sort()].map((v) => (
                <button
                  key={v ?? 'all'}
                  onClick={() => setViaFilter(v)}
                  className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${viaFilter === v ? 'border-forest bg-emerald-50 text-forest' : 'border-line-strong text-ink-soft hover:bg-paper'}`}
                >
                  {v ? `${v} · ${viaCounts.get(v)}` : `All · ${discover.length}`}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {folder !== 'archive' && shown.length > 1 && (
        <div className="mb-2 flex justify-end">
          <Button size="sm" variant="ghost" onClick={archiveAll}>Archive all {shown.length} →</Button>
        </div>
      )}
      {folder === 'archive' && archived.length > 0 && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs text-muted">
            {showOlder ? 'Everything you\'ve archived, newest first.' : `Archived in the last ${ARCHIVE_RECENT_DAYS} days.`}
          </p>
          <Button size="sm" variant="ghost" onClick={emptyArchive}>Empty archive</Button>
        </div>
      )}

      {shown.length === 0 && !(folder === 'archive' && olderCount) ? (
        <Empty folder={folder} needsFilters={needsFilters} onOpenSettings={onOpenSettings} />
      ) : (
        <div className="space-y-2.5">
          {shown.map((m) => (
            <MatchCard key={m.id} m={m} verdict={feedback[m.id]} onVerdict={onVerdict} onWatch={onWatch} />
          ))}
        </div>
      )}
      {folder === 'archive' && olderCount > 0 && (
        <div className="mt-3 text-center">
          <button className="text-sm font-semibold text-forest underline-offset-2 hover:underline" onClick={() => setShowOlder(!showOlder)}>
            {showOlder ? `Hide the ${olderCount} older than ${ARCHIVE_RECENT_DAYS} days` : `Show older (${olderCount})`}
          </button>
        </div>
      )}
    </section>
  );
}

function Empty({ folder, needsFilters, onOpenSettings }: { folder: Folder; needsFilters?: boolean; onOpenSettings?: () => void }) {
  if (folder === 'inbox' && needsFilters) {
    return (
      <div className="rounded-xl border border-dashed border-line-strong bg-white/60 px-5 py-8 text-center text-sm text-ink-soft">
        <p className="font-semibold">Tell JobSnipe what you're looking for</p>
        <p className="mt-1 text-muted">Set the job titles and places you want, then add the companies you'd love to work at.</p>
        {onOpenSettings && <Button variant="primary" className="mt-4" onClick={onOpenSettings}>Set your filters</Button>}
      </div>
    );
  }
  const text = {
    inbox: ['No new roles!', "You're all caught up. JobSnipe checks every hour and emails you when something new fits."],
    interested: ['Nothing starred yet', 'Mark a role ★ Interested and it lands here, even after the posting closes.'],
    not_for_me: ['Nothing dismissed', 'Roles you mark Not for me are kept here, out of your way.'],
    near: ['No near misses', 'Roles your filters hid for just one reason (pay, place, level or age) show up here.'],
    discover: ['Nothing to discover yet', 'Roles that pass all your filters at companies you don\'t watch show up here, from VC portfolio job boards checked every 4 hours.'],
    archive: ['Archive is empty', "Done with a role (applied, moved it to JobBoard, or it's just stale)? Archive it. It never comes back to your inbox, and you can delete it from here when you want it gone."],
  }[folder];
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-white/60 px-5 py-10 text-center">
      <p className="text-base font-bold text-ink">{text[0]}</p>
      <p className="mt-1 text-sm text-muted">{text[1]}</p>
    </div>
  );
}

function MatchCard({ m, verdict, onVerdict, onWatch }: { m: Match & { closed?: boolean }; verdict?: Verdict; onVerdict: Props['onVerdict']; onWatch: Props['onWatch'] }) {
  const [asking, setAsking] = useState(false);
  const [finding, setFinding] = useState(false);
  // Tailor resume: the posting's text (when its board can be read) and whether it reached the clipboard.
  const [tailor, setTailor] = useState<null | 'reading' | { text?: string; copied: boolean }>(null);
  const copyPosting = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false; // some browsers only allow copying straight from a click; the Copy button covers that
    }
  };
  const startTailor = async () => {
    setTailor('reading');
    const description = await postingDescription(m);
    const text = description ? postingForResume(m, description) : undefined;
    setTailor({ text, copied: text ? await copyPosting(text) : false });
  };
  const [watching, setWatching] = useState(false);
  // Watch: straight away when we know the company's board, otherwise look for it first.
  const watch = async () => {
    if (!(m.ats && m.board)) return setFinding(true);
    setWatching(true);
    try {
      await onWatch({ name: m.company, ats: m.ats, board: m.board });
    } finally {
      setWatching(false);
    }
  };
  const [reason, setReason] = useState('');
  const interested = verdict?.verdict === 'interested' && !verdict.archivedAt;
  const archived = !!verdict?.archivedAt;
  const isNew = !verdict && !m.nearMiss && Date.now() - Date.parse(m.firstSeenAt) < DAY;
  const base = { at: new Date().toISOString(), company: m.company, title: m.title, url: m.url || verdict?.url };
  const decide = (v: 'interested' | 'not_for_me', reason?: string) => onVerdict(m, { ...base, verdict: v, reason });
  // Archive keeps whatever you'd decided, so the Archive can show it.
  const archive = () => onVerdict(m, { ...base, ...verdict, archivedAt: new Date().toISOString() });
  // Restore: back to its folder, or to the inbox if it was archived without a decision.
  const restore = () => onVerdict(m, verdict?.verdict ? { ...verdict, archivedAt: undefined } : null);
  // Delete from the Archive: hidden for good, but remembered so the job never returns to the inbox.
  const remove = () => verdict && onVerdict(m, { ...verdict, deletedAt: new Date().toISOString() });
  const status = archived
    ? verdict?.verdict === 'interested' ? '★ Was Interested' : verdict?.verdict === 'not_for_me' ? 'Was Not for me' : 'Archived from inbox'
    : undefined;
  const manual = isManual(m.id);
  const facts = manual
    ? [`Added by you${verdict ? ` ${ago(verdict.at)}` : ''}`]
    : m.closed
    ? ['Posting closed or no longer matches']
    : [m.where, m.comp && money(m.comp), m.atsPostedAt && `posted ${ago(m.atsPostedAt)}`].filter(Boolean);

  const dismiss = () => {
    decide('not_for_me', reason.trim() || undefined);
    setAsking(false);
    setReason('');
  };

  return (
    <article
      className={`rounded-xl border bg-white px-4 py-3 shadow-[0_1px_0_rgba(0,0,0,.02)] ${interested ? 'border-forest-2 ring-1 ring-forest-2/30' : 'border-line'} ${(m.closed && !manual) || archived ? 'opacity-75' : ''}`}
      style={isNew ? { borderLeft: '3px solid var(--color-forest-2)' } : undefined}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">
            {m.company}
            {isNew && <span className="rounded bg-emerald-100 px-1.5 py-px text-[9.5px] text-forest">New</span>}
            {status && <span className="rounded bg-slate-100 px-1.5 py-px text-[9.5px] normal-case tracking-normal text-ink-soft">{status}</span>}
          </div>
          {safeHttpUrl(m.url) ? (
            <a href={safeHttpUrl(m.url)} target="_blank" rel="noreferrer" className="mt-0.5 block text-[16px] font-bold leading-snug text-forest-2 hover:underline">
              {m.title}
            </a>
          ) : (
            <div className="mt-0.5 text-[16px] font-bold leading-snug text-forest-2">{m.title}</div>
          )}
          <div className="mt-1 text-sm text-ink-soft">{facts.join(' · ')}</div>
          {m.nearMiss && (
            <div className="mt-1 text-[13px] text-brick">
              ✕ {m.nearMiss === 'location' ? `Outside your places: ${m.missDetail}` : m.missDetail}
            </div>
          )}
          {m.flags.length > 0 && <div className="mt-1 text-[13px] text-gold">⚑ {m.flags.join(' · ')}</div>}
          {m.via && !verdict && (
            <div className="mt-1 text-[12px] text-muted">
              via {m.via.join(', ')}{m.onList ? '' : ' · not on your list'}
              {linksElsewhere(m) && <> · <span className="text-gold">links to {linksElsewhere(m)}</span></>}
            </div>
          )}
          {verdict?.reason && <div className="mt-1 text-[13px] text-muted">“{verdict.reason}”</div>}
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:items-end">
          {archived ? (
            <div className="flex gap-1.5">
              <Button size="sm" variant="ghost" onClick={restore}>↩ Restore</Button>
              <Button size="sm" variant="ghost" onClick={remove} title="Gone for good (it still won't come back to your inbox)">Delete</Button>
            </div>
          ) : verdict ? (
            <>
              <Button size="sm" onClick={archive} title="Done with this role: move it to the Archive">Archive →</Button>
              {interested && !tailor && (
                <Button size="sm" variant="ghost" onClick={startTailor} title="Tailor your resume to this role with ResumeMachine, in your own AI assistant">
                  Tailor resume
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => onVerdict(m, null)}>{manual ? 'Remove' : '↩ Back to inbox'}</Button>
            </>
          ) : (
            !asking && (
              <div className="flex flex-wrap gap-1.5 sm:justify-end">
                <Button size="sm" onClick={() => decide('interested')}>{m.nearMiss ? '★ Interested anyway' : '★ Interested'}</Button>
                <Button size="sm" variant="ghost" onClick={() => setAsking(true)}>Not for me</Button>
                <Button size="sm" variant="ghost" onClick={archive} title="Not worth deciding (e.g. stale): archive it so it never comes back">Archive</Button>
                {m.via && !m.onList && (
                  <Button size="sm" variant="ghost" onClick={watch} disabled={watching} title="Add this company to your list: its new roles are checked hourly and emailed">
                    {watching ? 'Adding…' : '+ Watch company'}
                  </Button>
                )}
              </div>
            )
          )}
        </div>
      </div>

      {tailor && (
        <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3 text-sm sm:flex-row sm:items-center">
          {tailor === 'reading' ? (
            <span className="text-muted">Reading the posting…</span>
          ) : (
            <>
              <span className="min-w-0 flex-1 text-ink-soft">
                {tailor.copied
                  ? '✓ The posting is on your clipboard. Paste it into your ResumeMachine chat.'
                  : tailor.text
                  ? 'The posting is ready to copy.'
                  : "This site's posting can't be read from here. Open the job, copy its text, and paste it into your ResumeMachine chat."}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {tailor.text && !tailor.copied && (
                  <Button size="sm" onClick={async () => setTailor({ text: tailor.text, copied: await copyPosting(tailor.text!) })}>Copy posting</Button>
                )}
                <a
                  href={resumeMachineLink(m, tailor.copied)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-md bg-forest px-2.5 py-1 text-[13px] font-semibold text-white hover:bg-forest-deep"
                >
                  Open ResumeMachine →
                </a>
                <Button size="sm" variant="ghost" onClick={() => setTailor(null)}>Close</Button>
              </div>
            </>
          )}
        </div>
      )}

      {finding && (
        <FindBoard
          title={`Watch ${m.company}`}
          initialName={m.company}
          onClose={() => setFinding(false)}
          onPick={async (c) => {
            await onWatch(c);
            setFinding(false);
          }}
        />
      )}

      {asking && (
        <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:items-center">
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') dismiss();
              if (e.key === 'Escape') setAsking(false);
            }}
            placeholder="Why not? (optional; helps tune your filters)"
            className="min-w-0 flex-1 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
          />
          <div className="flex gap-1.5">
            <Button size="sm" variant="primary" onClick={dismiss}>Not for me</Button>
            <Button size="sm" variant="ghost" onClick={() => setAsking(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </article>
  );
}
