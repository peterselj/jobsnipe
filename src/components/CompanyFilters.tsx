import { useState } from 'react';
import type { Criteria, Watch, WatchFilters } from '../lib/types';
import { Button, Field, Input, Modal } from './ui';

const toList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/**
 * Tweaks to the usual filters for one company, e.g. "only Toronto here" for a company whose
 * New York roles are swamped with applicants. Picks from the person's own places.
 */
export default function CompanyFilters({ watch, criteria, onSave, onClose }: {
  watch: Watch;
  criteria: Criteria;
  onSave: (filters: WatchFilters | null) => Promise<void>;
  onClose: () => void;
}) {
  const areas = criteria.locations ?? [];
  const f = watch.filters;
  const [custom, setCustom] = useState(!!(f?.locations || f?.remote));
  const [places, setPlaces] = useState<string[]>((f?.locations ?? areas).map((a) => a.name));
  const [remote, setRemote] = useState(f?.remote ? !!f.remote.allowed : !!criteria.remote?.allowed);
  const [skip, setSkip] = useState((f?.exclude_titles ?? []).join(', '));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (next: WatchFilters | null) => {
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const build = (): WatchFilters | null => {
    const out: WatchFilters = {};
    if (custom) {
      out.locations = areas.filter((a) => places.includes(a.name));
      out.remote = { ...criteria.remote, allowed: remote };
    }
    if (toList(skip).length) out.exclude_titles = toList(skip);
    return Object.keys(out).length ? out : null;
  };

  const check = 'h-4 w-4 rounded border-slate-300 accent-[var(--color-forest)]';

  return (
    <Modal title={`Filters for ${watch.name}`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p className="text-muted">These apply only to {watch.name}. Everything else uses your usual filters from Settings.</p>

        <div className="space-y-2">
          <span className="block text-xs font-medium uppercase tracking-wide text-slate-500">Places</span>
          <label className="flex items-center gap-2">
            <input type="radio" className={check} checked={!custom} onChange={() => setCustom(false)} />
            My usual places
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" className={check} checked={custom} onChange={() => setCustom(true)} />
            Only these at {watch.name}:
          </label>
          {custom && (
            <div className="space-y-1.5 pl-6">
              {areas.map((a) => (
                <label key={a.name} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className={check}
                    checked={places.includes(a.name)}
                    onChange={(e) => setPlaces(e.target.checked ? [...places, a.name] : places.filter((p) => p !== a.name))}
                  />
                  {a.name}
                </label>
              ))}
              <label className="flex items-center gap-2">
                <input type="checkbox" className={check} checked={remote} onChange={(e) => setRemote(e.target.checked)} />
                Remote roles
              </label>
              {areas.length === 0 && <p className="text-muted">Add places in Settings first.</p>}
            </div>
          )}
        </div>

        <Field label={`Also skip titles at ${watch.name} containing`} hint="Comma-separated, e.g. technical. Your usual exclusions still apply.">
          <Input value={skip} onChange={(e) => setSkip(e.target.value)} placeholder="technical" />
        </Field>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="primary" disabled={saving || (custom && !places.length && !remote)} onClick={() => save(build())}>
            {saving ? 'Saving…' : 'Save and re-check'}
          </Button>
          {f && <Button variant="ghost" disabled={saving} onClick={() => save(null)}>Back to usual filters</Button>}
          <Button variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  );
}
