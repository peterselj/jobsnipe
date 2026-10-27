import { useState } from 'react';
import { money } from '../../shared/format';
import type { Criteria, Match, Profile } from '../lib/types';
import { Button, Field, Input, SectionHeader } from './ui';

// Lists are edited as comma-separated text: easy to read, easy to paste.
const toText = (xs?: string[]) => (xs ?? []).join(', ');
const toList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const num = (s: string) => (s.trim() === '' ? undefined : Number(s.replace(/[^\d.]/g, '')) || undefined);

const SENIOR_LEVELS = ['senior', 'sr', 'staff', 'principal', 'lead', 'group', 'director', 'head', 'vp'];
const COUNTRIES = [
  { code: 'US', label: 'United States' },
  { code: 'CA', label: 'Canada' },
];

interface Area {
  name: string;
  match: string;
}

/** Most common places among location near misses, e.g. [["San Francisco, CA", 18], ...]. */
function missedPlaces(nearMisses: Match[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const m of nearMisses) {
    if (m.nearMiss !== 'location' || !m.missDetail) continue;
    for (const place of new Set(m.missDetail.split(';').map((s) => s.trim()).filter(Boolean))) {
      counts.set(place, (counts.get(place) ?? 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 4);
}

/** Name, alert email, filters, pausing, and deleting the account. Saving re-checks right away. */
export default function Settings({ profile, nearMisses, onSave, onPause, onDelete, onCancel }: {
  profile: Profile;
  /** Roles the current filters hid for one reason; used to show what each filter is costing. */
  nearMisses: Match[];
  onSave: (patch: Pick<Profile, 'name' | 'email' | 'criteria'>) => Promise<void>;
  onPause: (paused: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
  onCancel: () => void;
}) {
  const c = profile.criteria;
  const [name, setName] = useState(profile.name);
  const [email, setEmail] = useState(profile.email);
  const [include, setInclude] = useState(toText(c.titles?.include));
  const [exclude, setExclude] = useState(toText(c.titles?.exclude));
  const [seniorOnly, setSeniorOnly] = useState(!!c.seniority?.require?.length);
  const [levels, setLevels] = useState(toText(c.seniority?.require ?? SENIOR_LEVELS));
  const [unlevelledPay, setUnlevelledPay] = useState(c.seniority?.unlevelled_pay_min?.toString() ?? '');
  const [areas, setAreas] = useState<Area[]>((c.locations ?? []).map((l) => ({ name: l.name, match: toText(l.match) })));
  const [remote, setRemote] = useState(c.remote?.allowed ?? false);
  const [countries, setCountries] = useState<string[]>(c.remote?.countries ?? ['US']);
  const [floorUsd, setFloorUsd] = useState(c.comp_floor?.USD?.toString() ?? '');
  const [floorCad, setFloorCad] = useState(c.comp_floor?.CAD?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setError(null);
    if (!email.includes('@')) return setError('Alerts need an email address.');
    if (!toList(include).length) return setError('Add at least one job title to look for.');
    if (!areas.some((a) => toList(a.match).length) && !remote) return setError('Add a location, or allow remote roles.');
    const comp_floor: Record<string, number> = {};
    if (num(floorUsd)) comp_floor.USD = num(floorUsd)!;
    if (num(floorCad)) comp_floor.CAD = num(floorCad)!;
    const criteria: Criteria = {
      ...c, // keep any fields this page doesn't edit yet
      titles: { include: toList(include), exclude: toList(exclude) },
      seniority: seniorOnly ? { require: toList(levels), unlevelled_pay_min: num(unlevelledPay) } : undefined,
      locations: areas.filter((a) => toList(a.match).length).map((a) => ({ name: a.name.trim() || toList(a.match)[0], match: toList(a.match) })),
      remote: { allowed: remote, countries: remote ? countries : [] },
      comp_floor,
    };
    setSaving(true);
    try {
      await onSave({ name: name.trim(), email: email.trim(), criteria });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  const card = 'rounded-xl border border-line bg-white p-5';
  const hint = 'mt-3 rounded-md bg-amber-50 px-3 py-2 text-[13px] text-amber-900';
  const missing = (k: Match['nearMiss']) => nearMisses.filter((m) => m.nearMiss === k);
  const payMisses = missing('pay');
  const places = missedPlaces(nearMisses);
  // What a different pay floor would do, from the roles the current one hides.
  const wouldAdd = (currency: string, floor?: number) =>
    floor === undefined ? payMisses.filter((m) => m.comp?.currency === currency).length : payMisses.filter((m) => m.comp?.currency === currency && m.comp.max >= floor).length;
  const savedFloor = (cur: string) => profile.criteria.comp_floor?.[cur];
  const payPreview = (cur: string, typed: string) => {
    const hidden = wouldAdd(cur);
    if (!hidden) return null;
    const n = num(typed);
    if (n !== undefined && n !== savedFloor(cur) && n < (savedFloor(cur) ?? Infinity)) {
      return `At ${money({ min: n, max: n, currency: cur }).split('–')[0]}, ${wouldAdd(cur, n)} of those would show up.`;
    }
    return null;
  };
  const check = 'h-4 w-4 rounded border-slate-300 accent-[var(--color-forest)]';

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PauseCard paused={profile.alerts_paused} onPause={onPause} />

      <div className={card}>
        <SectionHeader title="You" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Send alerts to" hint="One email per new match, as it's found.">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
        </div>
      </div>

      <div className={card}>
        <SectionHeader title="Job titles" />
        <div className="space-y-3">
          <Field label="Titles containing any of" hint="Comma-separated, any case. Example: product manager, head of product">
            <Input value={include} onChange={(e) => setInclude(e.target.value)} placeholder="product manager, account manager" />
          </Field>
          <Field label="But not containing" hint="Example: product marketing, intern, associate">
            <Input value={exclude} onChange={(e) => setExclude(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className={check} checked={seniorOnly} onChange={(e) => setSeniorOnly(e.target.checked)} />
            Senior and up only
          </label>
          {seniorOnly && (
            <div className="grid gap-3 border-l-2 border-line pl-4 sm:grid-cols-[1fr_200px]">
              <Field label="Title must include one of"><Input value={levels} onChange={(e) => setLevels(e.target.value)} /></Field>
              <Field label="…or, with no level in the title, pay from" hint="Some companies never put levels in titles.">
                <Input inputMode="numeric" value={unlevelledPay} onChange={(e) => setUnlevelledPay(e.target.value)} placeholder="180000" />
              </Field>
            </div>
          )}
          {missing('seniority').length > 0 && (
            <p className={hint}>Senior-and-up is hiding {missing('seniority').length} open role{missing('seniority').length > 1 ? 's' : ''} that otherwise fit. See them under Near misses.</p>
          )}
        </div>
      </div>

      <div className={card}>
        <SectionHeader title="Where">
          <Button size="sm" onClick={() => setAreas([...areas, { name: '', match: '' }])}>+ Add a place</Button>
        </SectionHeader>
        <div className="space-y-3">
          {areas.map((a, i) => (
            <div key={i} className="grid items-end gap-2 sm:grid-cols-[160px_1fr_auto]">
              <Field label="Name"><Input value={a.name} onChange={(e) => setAreas(areas.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="NYC area" /></Field>
              <Field label="Matches locations containing">
                <Input value={a.match} onChange={(e) => setAreas(areas.map((x, j) => (j === i ? { ...x, match: e.target.value } : x)))} placeholder="new york, nyc, brooklyn" />
              </Field>
              <Button variant="ghost" onClick={() => setAreas(areas.filter((_, j) => j !== i))} aria-label="Remove place">✕</Button>
            </div>
          ))}
          {areas.length === 0 && <p className="text-sm text-muted">No places yet. Add a city or region, or allow remote roles below.</p>}
          <label className="flex items-center gap-2 pt-1 text-sm">
            <input type="checkbox" className={check} checked={remote} onChange={(e) => setRemote(e.target.checked)} />
            Also remote roles open to
          </label>
          {remote && (
            <div className="flex flex-wrap gap-4 pl-6">
              {COUNTRIES.map((k) => (
                <label key={k.code} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className={check}
                    checked={countries.includes(k.code)}
                    onChange={(e) => setCountries(e.target.checked ? [...countries, k.code] : countries.filter((x) => x !== k.code))}
                  />
                  {k.label}
                </label>
              ))}
            </div>
          )}
          {places.length > 0 && (
            <p className={hint}>
              Places hiding the most roles that otherwise fit: {places.map(([p, n]) => `${p} (${n})`).join(' · ')}.
            </p>
          )}
        </div>
      </div>

      <div className={card}>
        <SectionHeader title="Pay" />
        <p className="mb-3 text-sm text-muted">Hide roles whose listed range tops out below this. Roles with no range listed are kept and flagged.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="US dollars" hint={payPreview('USD', floorUsd)}>
            <Input inputMode="numeric" value={floorUsd} onChange={(e) => setFloorUsd(e.target.value)} placeholder="140000" />
          </Field>
          <Field label="Canadian dollars" hint={payPreview('CAD', floorCad)}>
            <Input inputMode="numeric" value={floorCad} onChange={(e) => setFloorCad(e.target.value)} placeholder="140000" />
          </Field>
        </div>
        {payMisses.length > 0 && (
          <p className={hint}>
            Your floor is hiding {payMisses.length} open role{payMisses.length > 1 ? 's' : ''} that otherwise fit (
            {payMisses.slice(0, 3).map((m) => `${m.company} ${money(m.comp!)}`).join(', ')}
            {payMisses.length > 3 ? ', …' : ''}). Type a lower number to see how many would show up.
          </p>
        )}
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save and re-check'}</Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
      </div>

      <DeleteCard onDelete={onDelete} />
    </div>
  );
}

function PauseCard({ paused, onPause }: { paused: boolean; onPause: (p: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      await onPause(!paused);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border p-5 ${paused ? 'border-amber-300 bg-amber-50' : 'border-line bg-white'}`}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-bold">Email alerts are {paused ? 'paused' : 'on'}</div>
        <p className="text-sm text-muted">
          {paused
            ? "Your inbox here still updates every hour. Nothing found while paused is emailed later."
            : 'Pause any time, e.g. once you have an offer. Your inbox here keeps updating.'}
        </p>
      </div>
      <Button variant={paused ? 'primary' : 'secondary'} onClick={toggle} disabled={busy}>
        {paused ? 'Resume alerts' : 'Pause alerts'}
      </Button>
    </div>
  );
}

function DeleteCard({ onDelete }: { onDelete: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };
  return (
    <div className="mb-8 rounded-xl border border-red-200 bg-white p-5">
      <div className="text-sm font-bold text-red-700">Delete account</div>
      <p className="mt-1 text-sm text-muted">
        Permanently removes your sign-in, settings, companies, matches and Interested / Not for me. This can't be undone.
      </p>
      {!open ? (
        <Button variant="danger" className="mt-3" onClick={() => setOpen(true)}>Delete my account…</Button>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input className="max-w-[220px]" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder='Type "delete" to confirm' />
          <Button variant="danger" disabled={busy || typed.trim().toLowerCase() !== 'delete'} onClick={go}>
            {busy ? 'Deleting…' : 'Delete everything'}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
        </div>
      )}
      {error && <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
