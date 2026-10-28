import { useState } from 'react';
import { ago, money } from '../../shared/format';
import type { Feedback, Match, Verdict } from '../lib/types';
import { Button } from './ui';

type Folder = 'inbox' | 'interested' | 'not_for_me' | 'near' | 'archive';
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
}

const DAY = 86_400_000;

/**
 * Matches as an inbox: everything not yet decided sits in Inbox until marked Interested or Not for
 * me, or archived. Done with a role? Archive it; the Archive keeps it (and what you thought of it) for
 * good, so it never comes back. Decided and archived roles are read from the saved verdicts, so
 * they stay listed after the posting closes.
 */
export default function Matches({ matches, feedback, onVerdict, onVerdicts, needsFilters, onOpenSettings }: Props) {
  const [folder, setFolder] = useState<Folder>('inbox');
  const [missFilter, setMissFilter] = useState<MissCheck | null>(null);
  const open = new Map(matches.map((m) => [m.id, m]));

  const inbox = matches.filter((m) => !m.nearMiss && !feedback[m.id]);
  // Near misses: right job family, missed by one filter. Marking one Interested moves it to Interested.
  const near = matches.filter((m) => m.nearMiss && !feedback[m.id]);
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
    archive: fromVerdicts((f) => !!f.archivedAt, (f) => f.archivedAt!),
  };
  const shown = lists[folder];

  // Archive everything in the current view, keeping each role's decision.
  const archiveAll = () => {
    const where = tabs.find((t) => t.key === folder)!.label.replace('★ ', '') + (folder === 'near' && missFilter ? ` (${MISS_LABEL[missFilter]})` : '');
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
    { key: 'archive', label: 'Archive' },
  ];

  return (
    <section>
      <div className="mb-3 flex items-center gap-1 border-b border-line-strong" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={folder === t.key}
            onClick={() => setFolder(t.key)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
              folder === t.key ? 'border-forest text-ink' : 'border-transparent text-muted hover:text-ink-soft'
            }`}
          >
            {t.label}
            <span className={`rounded-full px-1.5 py-px font-mono text-[10px] ${t.key === 'inbox' && inbox.length ? 'bg-forest text-white' : 'bg-slate-200 text-ink-soft'}`}>
              {t.key === 'near' ? near.length : lists[t.key].length}
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

      {folder !== 'archive' && shown.length > 1 && (
        <div className="mb-2 flex justify-end">
          <Button size="sm" variant="ghost" onClick={archiveAll}>Archive all {shown.length} →</Button>
        </div>
      )}

      {shown.length === 0 ? (
        <Empty folder={folder} needsFilters={needsFilters} onOpenSettings={onOpenSettings} />
      ) : (
        <div className="space-y-2.5">
          {shown.map((m) => (
            <MatchCard key={m.id} m={m} verdict={feedback[m.id]} onVerdict={onVerdict} />
          ))}
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
    archive: ['Archive is empty', "Done with a role (applied, moved it to JobBoard, or it's just stale)? Archive it. It stays here and never comes back to your inbox."],
  }[folder];
  return (
    <div className="rounded-xl border border-dashed border-line-strong bg-white/60 px-5 py-10 text-center">
      <p className="text-base font-bold text-ink">{text[0]}</p>
      <p className="mt-1 text-sm text-muted">{text[1]}</p>
    </div>
  );
}

function MatchCard({ m, verdict, onVerdict }: { m: Match & { closed?: boolean }; verdict?: Verdict; onVerdict: Props['onVerdict'] }) {
  const [asking, setAsking] = useState(false);
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
  const status = archived
    ? verdict?.verdict === 'interested' ? '★ Was Interested' : verdict?.verdict === 'not_for_me' ? 'Was Not for me' : 'Archived from inbox'
    : undefined;
  const facts = m.closed
    ? ['Posting closed or no longer matches']
    : [m.where, m.comp && money(m.comp), m.atsPostedAt && `posted ${ago(m.atsPostedAt)}`].filter(Boolean);

  const dismiss = () => {
    decide('not_for_me', reason.trim() || undefined);
    setAsking(false);
    setReason('');
  };

  return (
    <article
      className={`rounded-xl border bg-white px-4 py-3 shadow-[0_1px_0_rgba(0,0,0,.02)] ${interested ? 'border-forest-2 ring-1 ring-forest-2/30' : 'border-line'} ${m.closed || archived ? 'opacity-75' : ''}`}
      style={isNew ? { borderLeft: '3px solid var(--color-forest-2)' } : undefined}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">
            {m.company}
            {isNew && <span className="rounded bg-emerald-100 px-1.5 py-px text-[9.5px] text-forest">New</span>}
            {status && <span className="rounded bg-slate-100 px-1.5 py-px text-[9.5px] normal-case tracking-normal text-ink-soft">{status}</span>}
          </div>
          {m.url ? (
            <a href={m.url} target="_blank" rel="noreferrer" className="mt-0.5 block text-[16px] font-bold leading-snug text-forest-2 hover:underline">
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
          {verdict?.reason && <div className="mt-1 text-[13px] text-muted">“{verdict.reason}”</div>}
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:items-end">
          {archived ? (
            <Button size="sm" variant="ghost" onClick={restore}>↩ Restore</Button>
          ) : verdict ? (
            <>
              <Button size="sm" onClick={archive} title="Done with this role: move it to the Archive">Archive →</Button>
              <Button size="sm" variant="ghost" onClick={() => onVerdict(m, null)}>↩ Back to inbox</Button>
            </>
          ) : (
            !asking && (
              <div className="flex flex-wrap gap-1.5 sm:justify-end">
                <Button size="sm" onClick={() => decide('interested')}>{m.nearMiss ? '★ Interested anyway' : '★ Interested'}</Button>
                <Button size="sm" variant="ghost" onClick={() => setAsking(true)}>Not for me</Button>
                <Button size="sm" variant="ghost" onClick={archive} title="Not worth deciding (e.g. stale): archive it so it never comes back">Archive</Button>
              </div>
            )
          )}
        </div>
      </div>

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
