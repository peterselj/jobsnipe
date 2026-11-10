import { useState } from 'react';
import { stageLabel, tooBroadTitles } from '../../shared/criteria';
import { money } from '../../shared/format';
import { INBOX_DOMAIN } from '../lib/inbox';
import type { Suggestion } from '../lib/suggest';
import { JOBBOARD } from '../lib/jobboard';
import type { Criteria, DigestEvery, DiscoverSource, InboxEmail, Match, Profile } from '../lib/types';
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

/** Funding stages from earliest to latest, for listing them in a sensible order. */
const STAGE_ORDER = ['pre_seed', 'seed', 'series_a', 'series_b', 'series_c', 'series_d', 'series_e', 'series_f', 'growth', 'private_equity', 'ipo', 'acquired', 'other'];

const stageRank = (s: string) => (STAGE_ORDER.includes(s) ? STAGE_ORDER.indexOf(s) : STAGE_ORDER.length);

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
export default function Settings({ profile, nearMisses, discoverRoles, discoverSources, inboxEmails, suggestions, jobBoard, onSave, onPause, onDigest, onInbox, onJobBoard, onAcceptSuggestion, onDismissSuggestion, onDelete, onCancel }: {
  profile: Profile;
  /** Roles in Discover right now, for suggesting industries and stages to skip. */
  discoverRoles: Match[];
  discoverSources: DiscoverSource[];
  inboxEmails: InboxEmail[];
  onInbox: (on: boolean) => Promise<void>;
  /** Changes worth considering, drawn from this person's decisions; nothing applies until accepted. */
  suggestions: Suggestion[];
  onAcceptSuggestion: (s: Suggestion) => Promise<void>;
  onDismissSuggestion: (s: Suggestion) => Promise<void>;
  /** Whether "Send to JobBoard" is on for this account. */
  jobBoard: boolean;
  onJobBoard: (on: boolean) => Promise<void>;
  onDigest: (every: DigestEvery) => Promise<void>;
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
  const [maxAge, setMaxAge] = useState(c.max_age_days?.toString() ?? '');
  const [skipIndustries, setSkipIndustries] = useState(toText(c.discover?.skip_industries));
  const [skipStages, setSkipStages] = useState<string[]>(c.discover?.skip_stages ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What the roles in Discover right now would let you skip: their commonest industries (minus ones
  // already skipped) and the stages their companies are at (plus any you've already ticked).
  const industryCounts = new Map<string, number>();
  const stageCounts = new Map<string, number>();
  for (const m of discoverRoles) {
    for (const i of new Set(m.industries ?? [])) industryCounts.set(i, (industryCounts.get(i) ?? 0) + 1);
    if (m.stage) stageCounts.set(m.stage, (stageCounts.get(m.stage) ?? 0) + 1);
  }
  const skipping = toList(skipIndustries).map((w) => w.toLowerCase());
  const topIndustries = [...industryCounts].filter(([name]) => !skipping.some((w) => name.toLowerCase().includes(w))).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const stages = [...new Set([...stageCounts.keys(), ...skipStages])].sort((a, b) => stageRank(a) - stageRank(b) || a.localeCompare(b));

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
      max_age_days: num(maxAge),
      discover: toList(skipIndustries).length || skipStages.length ? { skip_industries: toList(skipIndustries), skip_stages: skipStages } : undefined,
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
      {suggestions.length > 0 && <SuggestionsCard suggestions={suggestions} onAccept={onAcceptSuggestion} onDismiss={onDismissSuggestion} />}
      <PauseCard paused={profile.alerts_paused} onPause={onPause} />
      <DigestCard every={profile.digest_every} sources={discoverSources} onChange={onDigest} />
      <InboxCard token={profile.inbox_token ?? null} emails={inboxEmails} onSet={onInbox} />
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-white p-5">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-bold">Send to JobBoard is {jobBoard ? 'on' : 'off'}</div>
          <p className="text-sm text-muted">
            Adds a “→ JobBoard” button to ★ Interested roles. It opens{' '}
            <a className="text-forest underline-offset-2 hover:underline" href={JOBBOARD} target="_blank" rel="noreferrer">JobBoard</a>, a
            referral-first tracker for the roles you're pursuing, with the role filled in, and archives the role here.
          </p>
        </div>
        <Button variant="secondary" onClick={() => onJobBoard(!jobBoard)}>{jobBoard ? 'Turn off' : 'Turn on'}</Button>
      </div>

      <div className={card}>
        <SectionHeader title="You" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Sign in and send alerts to" hint="One email per new match. Changing it sends a confirmation link first.">
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
          {tooBroadTitles(toList(include)).map((word) => (
            <p key={word} className={hint} style={{ marginTop: 0 }}>
              <b>“{word}”</b> by itself matches every {word} role in any field (sales, engineering…), in your inbox and in Discover. Did you mean
              something like “{word} of product”? “{word[0].toUpperCase() + word.slice(1)}” already counts as a level under <i>Senior and up only</i>.
            </p>
          ))}
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

      <div className={card}>
        <SectionHeader title="Freshness" />
        <p className="mb-3 text-sm text-muted">
          Roles left up for months are usually evergreen listings or long since filled. Older ones skip your inbox and
          show under Near misses instead.
        </p>
        <Field label="Skip roles posted more than this many days ago" hint="Leave blank for any age.">
          <Input className="max-w-[160px]" inputMode="numeric" value={maxAge} onChange={(e) => setMaxAge(e.target.value)} placeholder="60" />
        </Field>
        {missing('age').length > 0 && (
          <p className={hint}>Your limit is hiding {missing('age').length} open role{missing('age').length > 1 ? 's' : ''} that otherwise fit. See them under Near misses → Age.</p>
        )}
      </div>

      <div className={card}>
        <SectionHeader title="Discover filters" />
        <p className="mb-3 text-sm text-muted">
          Only for the Discover tab and its digest: skip whole kinds of company, using what the VC boards say about each one.
          Companies on your list are never affected.
        </p>
        <Field label="Skip industries containing" hint="Comma-separated. “biotech” also skips Biotechnology.">
          <Input value={skipIndustries} onChange={(e) => setSkipIndustries(e.target.value)} placeholder="biotech, pharma, crypto" />
        </Field>
        {topIndustries.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            Most common in your Discover now:
            {topIndustries.map(([name, n]) => (
              <button
                key={name}
                type="button"
                onClick={() => setSkipIndustries(toText([...toList(skipIndustries), name.toLowerCase()]))}
                className="rounded-full border border-line-strong px-2 py-0.5 text-ink-soft hover:bg-paper"
                title="Skip this industry"
              >
                {name} · {n}
              </button>
            ))}
          </div>
        )}
        {stages.length > 0 && (
          <div className="mt-4">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[.06em] text-muted">Skip companies at these stages</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {stages.map((s) => (
                <label key={s} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    className={check}
                    checked={skipStages.includes(s)}
                    onChange={(e) => setSkipStages(e.target.checked ? [...skipStages, s] : skipStages.filter((x) => x !== s))}
                  />
                  {stageLabel(s)}
                  {stageCounts.get(s) ? <span className="text-xs text-muted">· {stageCounts.get(s)}</span> : null}
                </label>
              ))}
            </div>
          </div>
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

function SuggestionsCard({ suggestions, onAccept, onDismiss }: { suggestions: Suggestion[]; onAccept: (s: Suggestion) => Promise<void>; onDismiss: (s: Suggestion) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const run = async (s: Suggestion, fn: (s: Suggestion) => Promise<void>) => {
    setBusy(s.id);
    try {
      await fn(s);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="rounded-xl border border-forest-2/50 bg-emerald-50/40 p-5">
      <SectionHeader title={`Suggestions · ${suggestions.length}`} />
      <p className="mb-3 text-sm text-muted">
        Patterns in what you've marked ★ Interested and Not for me. Nothing changes unless you accept it, and anything you accept can be
        undone in the filters below.
      </p>
      <ul className="space-y-2.5">
        {suggestions.map((s) => (
          <li key={s.id} className="rounded-lg border border-line bg-white px-4 py-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-ink">{s.text}</div>
                <div className="mt-0.5 text-[13px] text-ink-soft">
                  {s.why}{' '}
                  <button className="font-medium text-forest underline-offset-2 hover:underline" onClick={() => setOpen(open === s.id ? null : s.id)}>
                    {open === s.id ? 'Hide' : `See the ${s.evidence.length}`}
                  </button>
                </div>
                {open === s.id && (
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-[13px] text-muted">
                    {s.evidence.slice(0, 12).map((e, i) => <li key={i}>{e}</li>)}
                    {s.evidence.length > 12 && <li>and {s.evidence.length - 12} more</li>}
                  </ul>
                )}
              </div>
              <div className="flex shrink-0 gap-1.5">
                <Button size="sm" variant="primary" disabled={busy !== null} onClick={() => run(s, onAccept)}>{busy === s.id ? 'Working…' : 'Accept'}</Button>
                <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => run(s, onDismiss)}>Dismiss</Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
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

const DIGEST_OPTIONS: { value: DigestEvery; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'never', label: 'Never (just the Discover tab)' },
];

function DigestCard({ every, sources, onChange }: { every: DigestEvery; sources: DiscoverSource[]; onChange: (e: DigestEvery) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const change = async (e: DigestEvery) => {
    setBusy(true);
    try {
      await onChange(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-xl border border-line bg-white p-5">
      <SectionHeader title="Discover digest" />
      <p className="mb-3 text-sm text-muted">
        Roles that pass all your filters at companies you don't watch, found on VC portfolio job boards
        {sources.length ? ` (${sources.map((s) => s.name).join(', ')})` : ''}. They're never emailed one by one; a digest sums up
        what's new.
      </p>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="How often">
        {DIGEST_OPTIONS.map((o) => (
          <button
            key={o.value}
            role="radio"
            aria-checked={every === o.value}
            disabled={busy}
            onClick={() => every !== o.value && change(o.value)}
            className={`rounded-full border px-3 py-1 text-sm font-medium ${every === o.value ? 'border-forest bg-emerald-50 text-forest' : 'border-line-strong text-ink-soft hover:bg-paper'}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function InboxCard({ token, emails, onSet }: { token: string | null; emails: InboxEmail[]; onSet: (on: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const address = token ? `${token}@${INBOX_DOMAIN}` : '';
  const set = async (on: boolean) => {
    if (!on && !confirm('Turn off your job-alert inbox? Mail to this address will be dropped. Turning it back on gives you a new address.')) return;
    setBusy(true);
    try {
      await onSet(on);
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the address is on screen to copy by hand.
    }
  };
  return (
    <div className="rounded-xl border border-line bg-white p-5">
      <SectionHeader title="Job-alert inbox" />
      <p className="mb-3 text-sm text-muted">
        An email address for job alerts from LinkedIn, Indeed, Wellfound or VC job boards (Sequoia, a16z…). Each hour JobSnipe reads
        what arrived: roles that pass your filters go to Discover, or to your Inbox (with an email) when they're at a company on your
        list that JobSnipe can't check directly. Free-form newsletters aren't read yet.
      </p>
      {!token ? (
        <Button variant="primary" onClick={() => set(true)} disabled={busy}>{busy ? 'Turning on…' : 'Get my alerts address'}</Button>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-md bg-paper px-2.5 py-1.5 font-mono text-sm text-ink">{address}</code>
            <Button size="sm" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
            <Button size="sm" variant="ghost" onClick={() => set(false)} disabled={busy}>Turn off</Button>
          </div>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-[13px] text-ink-soft">
            <li><b>LinkedIn, Indeed, Wellfound, VC boards:</b> create a job alert and use this address, or change an existing alert's email.</li>
            <li><b>Alerts already going to Gmail:</b> Settings → Forwarding → add this address. Gmail sends a confirmation code here; it shows up below within a minute or two.</li>
          </ul>
          <div className="mt-4">
            <div className="mb-1 text-xs font-semibold uppercase tracking-[.06em] text-muted">Recent emails</div>
            {emails.length === 0 ? (
              <p className="text-sm text-muted">Nothing yet. Emails show up here a minute or two after they're sent.</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                {emails.map((e) => (
                  <li key={e.id} className="px-3 py-2">
                    <button className="flex w-full items-start justify-between gap-3 text-left" onClick={() => setOpen(open === e.id ? null : e.id)}>
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-ink">{e.subject || '(no subject)'}</span>
                        <span className="block truncate text-xs text-muted">{e.fromName || e.fromAddress} · {new Date(e.receivedAt).toLocaleString()}</span>
                      </span>
                      <span className="shrink-0 text-xs text-ink-soft">
                        {e.jobsFound === undefined ? 'not read yet' : e.jobsFound ? `${e.jobsFound} job${e.jobsFound === 1 ? '' : 's'} found` : 'no jobs found'}
                      </span>
                    </button>
                    {open === e.id && e.text && <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-paper p-2 text-xs text-ink-soft">{e.text.slice(0, 3000)}</pre>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
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
