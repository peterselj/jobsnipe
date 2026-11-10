import { useEffect, useRef, useState } from 'react';
import { BOOKMARKLET, cleanRoleUrl, lookUpRole, roleFromPage, type RoleDraft } from '../lib/addRole';
import { Button, Field, Input, Modal } from './ui';

/**
 * Add a role you found yourself (LinkedIn, a referral, anywhere) straight to Interested. Paste its
 * link; the title and company fill in when the link says enough, and you can always type them.
 */
export default function AddRole({ initial, onClose, onAdd }: {
  initial?: RoleDraft;
  onClose: () => void;
  onAdd: (role: RoleDraft) => Promise<void>;
}) {
  const [url, setUrl] = useState(initial?.url ?? '');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [company, setCompany] = useState(initial?.company ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bookmark = useRef<HTMLAnchorElement>(null);

  // Set outside React, which doesn't let a link's address be a script; this one is only ever dragged
  // to the bookmarks bar.
  useEffect(() => bookmark.current?.setAttribute('href', BOOKMARKLET), []);

  // A pasted link fills in what it can: from the link itself, then (Greenhouse, Lever) the board's API.
  const onLink = async (value: string) => {
    setUrl(value);
    setError(null);
    const clean = cleanRoleUrl(value.trim());
    if (!clean) return;
    const guess = roleFromPage(clean);
    if (!company.trim() && guess.company) setCompany(guess.company);
    const found = await lookUpRole(clean);
    if (found?.title) setTitle((t) => t.trim() || found.title!);
    if (found?.company) setCompany((c) => (c.trim() && c !== guess.company ? c : found.company!));
  };

  const save = async () => {
    const clean = cleanRoleUrl(url.trim());
    if (!clean) return setError('Paste the link to the job (it should start with https://).');
    if (!title.trim()) return setError('Give the role its title.');
    if (!company.trim()) return setError('Which company is it at?');
    setSaving(true);
    try {
      await onAdd({ url: clean, title: title.trim().slice(0, 200), company: company.trim().slice(0, 120) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <Modal title="Add a role" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-muted">Found a job yourself, on LinkedIn or anywhere else? Add it here and it goes to ★ Interested.</p>
        <Field label="Link to the job">
          <Input autoFocus value={url} onChange={(e) => void onLink(e.target.value)} placeholder="https://www.linkedin.com/jobs/view/…" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Senior Product Manager" /></Field>
          <Field label="Company"><Input value={company} onChange={(e) => setCompany(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} /></Field>
        </div>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Adding…' : 'Add to Interested'}</Button>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        </div>
        <div className="border-t border-line pt-3 text-[13px] text-ink-soft">
          <b>One-click version:</b> drag this to your bookmarks bar →{' '}
          <a
            ref={bookmark}
            onClick={(e) => e.preventDefault()}
            className="inline-block cursor-grab rounded-md border border-line-strong bg-paper px-2 py-0.5 font-semibold text-forest"
            title="Drag me to your bookmarks bar"
          >
            ＋ Save to JobSnipe
          </a>
          . Then, on any job page, click it and the role opens here with its link and title filled in.
        </div>
      </div>
    </Modal>
  );
}
