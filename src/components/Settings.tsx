import { useState } from 'react';
import type { Criteria, Profile } from '../lib/types';
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

/** Name, alert email, and filters. Saving re-checks so matches reflect the new filters right away. */
export default function Settings({ profile, onSave, onCancel }: {
  profile: Profile;
  onSave: (patch: Pick<Profile, 'name' | 'email' | 'criteria'>) => Promise<void>;
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
  const check = 'h-4 w-4 rounded border-slate-300 accent-[var(--color-forest)]';

  return (
    <div className="mx-auto max-w-2xl space-y-5">
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
        </div>
      </div>

      <div className={card}>
        <SectionHeader title="Pay" />
        <p className="mb-3 text-sm text-muted">Hide roles whose listed range tops out below this. Roles with no range listed are kept and flagged.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="US dollars"><Input inputMode="numeric" value={floorUsd} onChange={(e) => setFloorUsd(e.target.value)} placeholder="140000" /></Field>
          <Field label="Canadian dollars"><Input inputMode="numeric" value={floorCad} onChange={(e) => setFloorCad(e.target.value)} placeholder="140000" /></Field>
        </div>
      </div>

      {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex items-center gap-2 pb-8">
        <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save and re-check'}</Button>
        <Button variant="ghost" onClick={onCancel} disabled={saving}>Cancel</Button>
      </div>
    </div>
  );
}
