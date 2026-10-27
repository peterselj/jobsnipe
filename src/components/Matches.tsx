import { useState } from 'react';
import { ago, money } from '../../shared/format';
import type { Feedback, Match, Verdict } from '../lib/types';
import { Button } from './ui';

type Folder = 'inbox' | 'interested' | 'not_for_me';

interface Props {
  matches: Match[];
  feedback: Feedback;
  onVerdict: (m: Match, v: Verdict['verdict'] | null, reason?: string) => void;
  /** Shown in the inbox when there's nothing to triage because no filters are set. */
  needsFilters?: boolean;
  onOpenSettings?: () => void;
}

const DAY = 86_400_000;

/**
 * Matches as an inbox: everything not yet decided sits in Inbox until marked Interested or
 * Not for me. Interested keeps roles even after the posting closes (from the saved verdict).
 */
export default function Matches({ matches, feedback, onVerdict, needsFilters, onOpenSettings }: Props) {
  const [folder, setFolder] = useState<Folder>('inbox');
  const open = new Map(matches.map((m) => [m.id, m]));

  const inbox = matches.filter((m) => !feedback[m.id]);
  // Decided roles come from the verdicts, so they stay listed after the posting closes.
  const decided = (v: Verdict['verdict']) =>
    Object.entries(feedback)
      .filter(([, f]) => f.verdict === v)
      .sort(([, a], [, b]) => b.at.localeCompare(a.at))
      .map(([id, f]) => open.get(id) ?? { id, company: f.company, title: f.title, url: f.url ?? '', flags: [], firstSeenAt: f.at, closed: true });
  const lists: Record<Folder, (Match & { closed?: boolean })[]> = {
    inbox,
    interested: decided('interested'),
    not_for_me: decided('not_for_me'),
  };
  const shown = lists[folder];

  const tabs: { key: Folder; label: string }[] = [
    { key: 'inbox', label: 'Inbox' },
    { key: 'interested', label: '★ Interested' },
    { key: 'not_for_me', label: 'Not for me' },
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
              {lists[t.key].length}
            </span>
          </button>
        ))}
      </div>

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
  const interested = verdict?.verdict === 'interested';
  const isNew = !verdict && Date.now() - Date.parse(m.firstSeenAt) < DAY;
  const facts = m.closed
    ? ['Posting closed or no longer matches']
    : [m.where, m.comp && money(m.comp), m.atsPostedAt && `posted ${ago(m.atsPostedAt)}`].filter(Boolean);

  const dismiss = () => {
    onVerdict(m, 'not_for_me', reason.trim() || undefined);
    setAsking(false);
    setReason('');
  };

  return (
    <article
      className={`rounded-xl border bg-white px-4 py-3 shadow-[0_1px_0_rgba(0,0,0,.02)] ${interested ? 'border-forest-2 ring-1 ring-forest-2/30' : 'border-line'} ${m.closed ? 'opacity-70' : ''}`}
      style={isNew ? { borderLeft: '3px solid var(--color-forest-2)' } : undefined}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">
            {m.company}
            {isNew && <span className="rounded bg-emerald-100 px-1.5 py-px text-[9.5px] text-forest">New</span>}
          </div>
          {m.url ? (
            <a href={m.url} target="_blank" rel="noreferrer" className="mt-0.5 block text-[16px] font-bold leading-snug text-forest-2 hover:underline">
              {m.title}
            </a>
          ) : (
            <div className="mt-0.5 text-[16px] font-bold leading-snug text-forest-2">{m.title}</div>
          )}
          <div className="mt-1 text-sm text-ink-soft">{facts.join(' · ')}</div>
          {m.flags.length > 0 && <div className="mt-1 text-[13px] text-gold">⚑ {m.flags.join(' · ')}</div>}
          {verdict?.reason && <div className="mt-1 text-[13px] text-muted">“{verdict.reason}”</div>}
        </div>

        <div className="flex shrink-0 flex-wrap gap-1.5 sm:justify-end">
          {verdict ? (
            <Button size="sm" variant="ghost" onClick={() => onVerdict(m, null)}>↩ Back to inbox</Button>
          ) : (
            !asking && (
              <>
                <Button size="sm" onClick={() => onVerdict(m, 'interested')}>★ Interested</Button>
                <Button size="sm" variant="ghost" onClick={() => setAsking(true)}>Not for me</Button>
              </>
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
