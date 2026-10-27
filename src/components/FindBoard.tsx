import { useState } from 'react';
import { ATS_LABEL, boardUrl, findBoards, looksLikeUrl, type BoardHit } from '../lib/ats';
import type { CompanyConfig } from '../lib/types';
import { Button, Field, Input, Modal } from './ui';

/**
 * Find where a company posts jobs. A name is tried as likely board slugs on Greenhouse, Lever and Ashby;
 * a pasted job link is the sure route when the board name differs from the company name.
 */
export default function FindBoard({ title, initialName, onClose, onPick }: {
  title: string;
  initialName: string;
  onClose: () => void;
  onPick: (c: CompanyConfig) => Promise<void>;
}) {
  const [query, setQuery] = useState(initialName);
  const [name, setName] = useState(initialName);
  const [hits, setHits] = useState<BoardHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [careersUrl, setCareersUrl] = useState('');

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    setHits(null);
    try {
      const found = await findBoards(query.trim());
      setHits(found);
      if (!name.trim()) {
        const display = found[0]?.displayName;
        if (display) setName(display);
        else if (!looksLikeUrl(query)) setName(query.trim());
      }
    } finally {
      setSearching(false);
    }
  };

  const pick = async (c: CompanyConfig) => {
    if (!c.name.trim()) {
      setError('Give the company a name first.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onPick({ ...c, name: c.name.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Company name or a job link" hint="A link to any of their job postings is the surest way, e.g. jobs.ashbyhq.com/acme/…">
          <div className="flex gap-2">
            <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && search()} placeholder="Acme Robotics, or paste a job link" />
            <Button variant="primary" onClick={search} disabled={searching || !query.trim()}>{searching ? 'Looking…' : 'Find'}</Button>
          </div>
        </Field>

        {hits && (
          <>
            <Field label="Name to show">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Company name" />
            </Field>

            {hits.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs text-muted">Pick the board that's really theirs (check the sample roles):</p>
                {hits.map((h) => (
                  <div key={`${h.ats}:${h.board}`} className="flex items-start gap-3 rounded-lg border border-line px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">
                        {ATS_LABEL[h.ats]} · <a className="font-mono text-forest hover:underline" href={boardUrl(h.ats, h.board)} target="_blank" rel="noreferrer">{h.board}</a>
                        <span className="ml-2 text-xs font-normal text-muted">{h.jobs} open{h.displayName ? ` · "${h.displayName}"` : ''}</span>
                      </div>
                      {h.sample.length > 0 && <div className="mt-0.5 truncate text-xs text-muted">{h.sample.join(' · ')}</div>}
                    </div>
                    <Button size="sm" variant="primary" disabled={saving} onClick={() => pick({ name, ats: h.ats, board: h.board })}>Use this</Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-2 rounded-lg bg-paper px-3 py-3 text-sm">
                <p>
                  Not found on Greenhouse, Lever or Ashby. Try pasting a job link from their careers page; if they post
                  somewhere else, you can still list them as not monitored for now.
                </p>
                <Field label="Careers page (optional)">
                  <Input value={careersUrl} onChange={(e) => setCareersUrl(e.target.value)} placeholder="https://…" />
                </Field>
                <Button disabled={saving} onClick={() => pick({ name, ats: 'none', careers_url: careersUrl.trim() || undefined, note: 'job board not found yet' })}>
                  Add as not monitored
                </Button>
              </div>
            )}
          </>
        )}

        {saving && <p className="text-sm text-muted">Saving to your profile…</p>}
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      </div>
    </Modal>
  );
}
