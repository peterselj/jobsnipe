import { useState } from 'react';
import { ago, money } from '../lib/format';
import type { Feedback, Match, Verdict } from '../lib/types';
import { Button, SectionHeader } from './ui';

interface Props {
  matches: Match[];
  feedback: Feedback;
  /** Matches first seen after this count as new. */
  lastVisit?: string;
  onVerdict: (m: Match, v: Verdict['verdict'] | null, reason?: string) => void;
}

export default function Matches({ matches, feedback, lastVisit, onVerdict }: Props) {
  const [showDismissed, setShowDismissed] = useState(false);
  const dismissed = matches.filter((m) => feedback[m.id]?.verdict === 'not_for_me');
  const visible = matches.filter((m) => feedback[m.id]?.verdict !== 'not_for_me');
  const isNew = (m: Match) => !!lastVisit && m.firstSeenAt > lastVisit;
  const fresh = visible.filter(isNew);
  const rest = visible.filter((m) => !isNew(m));

  return (
    <section>
      {fresh.length > 0 && (
        <>
          <SectionHeader title={<>New since your last visit <Count n={fresh.length} accent /></>} />
          <div className="mb-7 space-y-2.5">
            {fresh.map((m) => <MatchCard key={m.id} m={m} isNew verdict={feedback[m.id]} onVerdict={onVerdict} />)}
          </div>
        </>
      )}

      <SectionHeader title={<>{fresh.length ? 'Still open' : 'Open matches'} <Count n={rest.length} /></>}>
        <span className="hidden text-xs text-muted sm:inline">Roles at your companies that pass your filters right now</span>
      </SectionHeader>
      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-strong bg-white/60 px-5 py-8 text-center text-sm text-muted">
          Nothing open passes your filters right now. New matches are emailed to you as soon as they're posted.
        </div>
      ) : (
        <div className="space-y-2.5">
          {rest.map((m) => <MatchCard key={m.id} m={m} verdict={feedback[m.id]} onVerdict={onVerdict} />)}
        </div>
      )}

      {dismissed.length > 0 && (
        <div className="mt-6">
          <button onClick={() => setShowDismissed((v) => !v)} className="text-xs font-medium text-muted hover:text-ink-soft">
            {showDismissed ? '▾' : '▸'} {dismissed.length} marked not for me
          </button>
          {showDismissed && (
            <div className="mt-2 space-y-2 opacity-75">
              {dismissed.map((m) => <MatchCard key={m.id} m={m} verdict={feedback[m.id]} onVerdict={onVerdict} />)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Count({ n, accent }: { n: number; accent?: boolean }) {
  return (
    <span className={`ml-1 rounded-full px-1.5 py-px font-mono text-[10px] ${accent ? 'bg-forest text-white' : 'bg-slate-200 text-ink-soft'}`}>{n}</span>
  );
}

function MatchCard({ m, verdict, isNew, onVerdict }: { m: Match; verdict?: Verdict; isNew?: boolean; onVerdict: Props['onVerdict'] }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const interested = verdict?.verdict === 'interested';
  const facts = [m.where, m.comp && money(m.comp), m.atsPostedAt && `posted ${ago(m.atsPostedAt)}`].filter(Boolean);

  const dismiss = () => {
    onVerdict(m, 'not_for_me', reason.trim() || undefined);
    setAsking(false);
    setReason('');
  };

  return (
    <article
      className={`rounded-xl border bg-white px-4 py-3 shadow-[0_1px_0_rgba(0,0,0,.02)] ${interested ? 'border-forest-2 ring-1 ring-forest-2/30' : 'border-line'}`}
      style={isNew ? { borderLeft: '3px solid var(--color-forest-2)' } : undefined}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">
            {m.company}
            {isNew && <span className="rounded bg-emerald-100 px-1.5 py-px text-[9.5px] text-forest">New</span>}
          </div>
          <a href={m.url} target="_blank" rel="noreferrer" className="mt-0.5 block text-[16px] font-bold leading-snug text-forest-2 hover:underline">
            {m.title}
          </a>
          <div className="mt-1 text-sm text-ink-soft">{facts.join(' · ')}</div>
          {m.flags.length > 0 && <div className="mt-1 text-[13px] text-gold">⚑ {m.flags.join(' · ')}</div>}
          {verdict?.verdict === 'not_for_me' && verdict.reason && <div className="mt-1 text-[13px] text-muted">“{verdict.reason}”</div>}
        </div>

        <div className="flex shrink-0 flex-wrap gap-1.5 sm:justify-end">
          {verdict ? (
            <>
              <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ${interested ? 'bg-emerald-100 text-forest' : 'bg-slate-100 text-muted'}`}>
                {interested ? '★ Interested' : 'Not for me'}
              </span>
              <Button size="sm" variant="ghost" onClick={() => onVerdict(m, null)}>Undo</Button>
            </>
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
