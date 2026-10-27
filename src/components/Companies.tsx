import { useState } from 'react';
import { ATS_LABEL, boardUrl } from '../lib/ats';
import { ago } from '../lib/format';
import type { CompanyConfig, CompanyHealth } from '../lib/types';
import FindBoard from './FindBoard';
import { Button, SectionHeader } from './ui';

interface Props {
  /** From the profile file: the list you control. */
  companies: CompanyConfig[];
  /** From the last hourly run: how each board is doing. */
  health: CompanyHealth[];
  onAdd: (c: CompanyConfig) => Promise<void>;
  onReplace: (index: number, c: CompanyConfig) => Promise<void>;
  onRemove: (index: number) => Promise<void>;
}

type Row = CompanyConfig & { index: number; h?: CompanyHealth };

const STATUS: Record<CompanyHealth['status'], { dot: string; label: string }> = {
  ok: { dot: 'bg-sage', label: 'Checking hourly' },
  failing: { dot: 'bg-brick', label: 'Board failing' },
  pending: { dot: 'bg-gold', label: 'Checked on the next run' },
  unmonitored: { dot: 'bg-slate-300', label: 'Not monitored' },
};

function healthFor(c: CompanyConfig, health: CompanyHealth[]): CompanyHealth | undefined {
  return c.ats === 'none'
    ? health.find((h) => h.ats === 'none' && h.name === c.name)
    : health.find((h) => h.ats === c.ats && h.board?.toLowerCase() === c.board?.toLowerCase());
}

export default function Companies({ companies, health, onAdd, onReplace, onRemove }: Props) {
  const [finding, setFinding] = useState<{ mode: 'add' } | { mode: 'fix'; row: Row } | null>(null);
  const rows: Row[] = companies.map((c, index) => ({ ...c, index, h: healthFor(c, health) }));
  const failing = rows.filter((r) => r.h?.status === 'failing').length;

  return (
    <section>
      <SectionHeader title={<>Companies <span className="ml-1 font-mono text-[10px] text-muted">{rows.length}</span></>}>
        <Button size="sm" variant="primary" onClick={() => setFinding({ mode: 'add' })}>+ Add company</Button>
      </SectionHeader>
      {failing > 0 && (
        <p className="mb-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
          {failing} board{failing > 1 ? 's are' : ' is'} failing, so new roles there won't reach you. Use "Change board" with a current job link to fix.
        </p>
      )}
      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
        {rows.map((r) => (
          <CompanyRow key={`${r.ats}:${r.board ?? r.name}`} r={r} onFix={() => setFinding({ mode: 'fix', row: r })} onRemove={() => onRemove(r.index)} />
        ))}
        {rows.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No companies yet. Add your first target.</li>}
      </ul>

      {finding && (
        <FindBoard
          title={finding.mode === 'add' ? 'Add a company' : `Change board for ${finding.row.name}`}
          initialName={finding.mode === 'fix' ? finding.row.name : ''}
          onClose={() => setFinding(null)}
          onPick={async (c) => {
            if (finding.mode === 'add') await onAdd(c);
            else await onReplace(finding.row.index, c);
            setFinding(null);
          }}
        />
      )}
    </section>
  );
}

function CompanyRow({ r, onFix, onRemove }: { r: Row; onFix: () => void; onRemove: () => void }) {
  const [busy, setBusy] = useState(false);
  const status = r.ats === 'none' ? 'unmonitored' : (r.h?.status ?? 'pending');
  const s = STATUS[status];
  const link = r.ats !== 'none' && r.board ? boardUrl(r.ats, r.board) : r.careers_url;
  const detail =
    // "HTTP 404 from https://boards-api…/jobs" -> "HTTP 404"; the board link is already on the row.
    status === 'failing' ? r.h?.lastError?.replace(/\s+(from|for)\s+https?:\/\/\S+/g, '')
    : status === 'unmonitored' ? r.note ?? 'No job board JobSnipe can read'
    : status === 'pending' ? 'Not checked yet'
    : `${r.h?.openPostings ?? 0} open · checked ${ago(r.h?.lastCheckedAt)}`;

  const remove = async () => {
    if (!confirm(`Stop watching ${r.name}?`)) return;
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
          <span className="text-sm font-semibold">{r.name}</span>
          {link && (
            <a href={link} target="_blank" rel="noreferrer" className="truncate font-mono text-[11px] text-muted hover:text-forest hover:underline">
              {r.ats === 'none' ? 'careers page' : `${ATS_LABEL[r.ats]} · ${r.board}`}
            </a>
          )}
        </div>
        <div className={`mt-0.5 text-xs ${status === 'failing' ? 'text-red-700' : 'text-muted'}`}>{detail}</div>
      </div>
      <div className="flex shrink-0 gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        <Button size="sm" variant="ghost" onClick={onFix} disabled={busy}>{r.ats === 'none' ? 'Find board' : 'Change board'}</Button>
        <Button size="sm" variant="ghost" onClick={remove} disabled={busy} aria-label={`Remove ${r.name}`}>✕</Button>
      </div>
    </li>
  );
}
