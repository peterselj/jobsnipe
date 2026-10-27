import { useState } from 'react';
import { ATS_LABEL, boardUrl } from '../lib/ats';
import { ago } from '../../shared/format';
import type { Ats, NewWatch, Watch } from '../lib/types';
import FindBoard from './FindBoard';
import { Button, SectionHeader } from './ui';

interface Props {
  watches: Watch[];
  onAdd: (w: NewWatch) => Promise<void>;
  onChangeBoard: (w: Watch, ats: Ats, board: string) => Promise<void>;
  onRemove: (w: Watch) => Promise<void>;
}

const STATUS: Record<Watch['status'], { dot: string; label: string }> = {
  ok: { dot: 'bg-sage', label: 'Checking hourly' },
  failing: { dot: 'bg-brick', label: 'Board failing' },
  pending: { dot: 'bg-gold', label: 'Not checked yet' },
  unmonitored: { dot: 'bg-slate-300', label: 'Not monitored' },
};

export default function Companies({ watches, onAdd, onChangeBoard, onRemove }: Props) {
  const [finding, setFinding] = useState<{ mode: 'add' } | { mode: 'fix'; w: Watch } | null>(null);
  const failing = watches.filter((w) => w.status === 'failing').length;

  return (
    <section>
      <SectionHeader title={<>Companies <span className="ml-1 font-mono text-[10px] text-muted">{watches.length}</span></>}>
        <Button size="sm" variant="primary" onClick={() => setFinding({ mode: 'add' })}>+ Add company</Button>
      </SectionHeader>
      {failing > 0 && (
        <p className="mb-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {failing} board{failing > 1 ? 's are' : ' is'} failing, so new roles there won't reach you. Use "Change board" with a current job link to fix.
        </p>
      )}
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
        {watches.map((w) => (
          <CompanyRow key={w.id} w={w} onFix={() => setFinding({ mode: 'fix', w })} onRemove={() => onRemove(w)} />
        ))}
        {watches.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No companies yet. Add the places you'd most like to work.</li>}
      </ul>

      {finding && (
        <FindBoard
          title={finding.mode === 'add' ? 'Add a company' : `Change board for ${finding.w.name}`}
          initialName={finding.mode === 'fix' ? finding.w.name : ''}
          allowUnmonitored={finding.mode === 'add'}
          onClose={() => setFinding(null)}
          onPick={async (c) => {
            if (finding.mode === 'add') await onAdd(c);
            else if (c.ats !== 'none' && c.board) await onChangeBoard(finding.w, c.ats, c.board);
            setFinding(null);
          }}
        />
      )}
    </section>
  );
}

function CompanyRow({ w, onFix, onRemove }: { w: Watch; onFix: () => void; onRemove: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const s = STATUS[w.status];
  const link = w.ats !== 'none' && w.board ? boardUrl(w.ats, w.board) : w.careersUrl;
  const detail =
    // "HTTP 404 from https://boards-api…/jobs" -> "HTTP 404"; the board link is already on the row.
    w.status === 'failing' ? w.lastError?.replace(/\s+(from|for)\s+https?:\/\/\S+/g, '')
    : w.status === 'unmonitored' ? w.note ?? 'No job board JobSnipe can read'
    : w.status === 'pending' ? 'Checking soon'
    : `${w.openPostings ?? 0} open · checked ${ago(w.lastCheckedAt)}`;

  const remove = async () => {
    if (!confirm(`Stop watching ${w.name}?`)) return;
    setBusy(true);
    try {
      await onRemove();
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="group flex items-start gap-3 px-4 py-2.5">
      <span title={s.label} className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold">{w.name}</span>
          {link && (
            <a href={link} target="_blank" rel="noreferrer" className="truncate font-mono text-[11px] text-muted hover:text-forest hover:underline">
              {w.ats === 'none' ? 'careers page' : `${ATS_LABEL[w.ats]} · ${w.board}`}
            </a>
          )}
        </div>
        <div className={`mt-0.5 text-xs ${w.status === 'failing' ? 'text-red-700' : 'text-muted'}`}>{detail}</div>
      </div>
      <div className="flex shrink-0 gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <Button size="sm" variant="ghost" onClick={onFix} disabled={busy}>{w.ats === 'none' ? 'Find board' : 'Change board'}</Button>
        <Button size="sm" variant="ghost" onClick={remove} disabled={busy} aria-label={`Remove ${w.name}`}>✕</Button>
      </div>
    </li>
  );
}
