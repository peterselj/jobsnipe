import type { Criteria } from '../../shared/criteria';
import { money } from '../../shared/format';
import type { Feedback, Match, Watch } from './types';

// Suggestions: patterns in what you've marked ★ Interested and Not for me, turned into specific
// changes to your filters. JobSnipe never changes a filter by itself: each suggestion shows what
// it's based on and does nothing until you accept it, and a dismissed one stays dismissed.

export interface Suggestion {
  /** Steady across visits, so a dismissed suggestion stays dismissed. */
  id: string;
  /** What would change, as an offer: "Skip titles containing “technical”?" */
  text: string;
  /** Why: one line, then the roles it's drawn from. */
  why: string;
  evidence: string[];
  /** What accepting does: new filters to save, or a company to stop watching. */
  criteria?: Criteria;
  removeWatch?: { id: number; name: string };
}

/** How many decisions a pattern needs before it's worth suggesting. */
export const MIN_EVIDENCE = 3;

// Words that are in most job titles, or say a level: never a reason to skip a role on their own.
const COMMON = new Set([
  'a', 'an', 'and', 'the', 'of', 'for', 'to', 'in', 'at', 'on', 'with', 'or', 'by', 'us', 'ii', 'iii', 'iv', 'i',
  'senior', 'sr', 'staff', 'principal', 'lead', 'group', 'director', 'head', 'vp', 'chief', 'associate', 'junior', 'jr', 'manager', 'management',
  'remote', 'hybrid', 'new', 'team', 'global',
]);

const words = (title: string) => title.toLowerCase().replace(/[^a-z0-9+#/ ]/g, ' ').split(/[\s/]+/).filter((w) => w.length > 1 && !/^\d+$/.test(w));

/** The single words and two-word phrases in a title that could be a reason to skip it. */
function terms(title: string, ignore: Set<string>): Set<string> {
  const ws = words(title);
  const out = new Set<string>();
  ws.forEach((w, i) => {
    if (!COMMON.has(w) && !ignore.has(w)) out.add(w);
    const next = ws[i + 1];
    if (next && !COMMON.has(w) && !COMMON.has(next) && !(ignore.has(w) && ignore.has(next))) out.add(`${w} ${next}`);
  });
  return out;
}

const roundDown = (n: number, step: number) => Math.floor(n / step) * step;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function suggest(input: { criteria: Criteria; feedback: Feedback; matches: Match[]; watches: Watch[] }): Suggestion[] {
  const { criteria: c, feedback, matches, watches } = input;
  const dismissed = new Set(c.dismissed_suggestions ?? []);
  const out: Suggestion[] = [];
  const verdicts = Object.entries(feedback).map(([id, v]) => ({ id, ...v })).filter((v) => !v.id.startsWith('manual:'));
  const passed = verdicts.filter((v) => v.verdict === 'not_for_me');
  const starred = verdicts.filter((v) => v.verdict === 'interested');
  const byId = new Map(matches.map((m) => [m.id, m]));

  // 1. A word or phrase that keeps showing up in titles you pass on, and never in ones you star.
  const include = (c.titles?.include ?? []).map((t) => t.toLowerCase());
  const exclude = (c.titles?.exclude ?? []).map((t) => t.toLowerCase());
  const inFamily = new Set(include.flatMap(words));
  const count = (list: typeof passed) => {
    const m = new Map<string, string[]>();
    for (const v of list) for (const t of terms(v.title, inFamily)) m.set(t, [...(m.get(t) ?? []), `${v.title} at ${v.company}`]);
    return m;
  };
  const passedTerms = count(passed);
  const starredTerms = count(starred);
  const reasons = passed.map((v) => (v.reason ?? '').toLowerCase()).join(' | ');
  const candidates = [...passedTerms]
    .filter(([t, roles]) => roles.length >= MIN_EVIDENCE && !starredTerms.has(t) && !exclude.some((e) => e.includes(t) || t.includes(e)) && !include.some((i) => i.includes(t)))
    // A word you also wrote as a reason comes first; then the most roles; then the longer phrase.
    .sort((a, b) => Number(reasons.includes(b[0])) - Number(reasons.includes(a[0])) || b[1].length - a[1].length || b[0].length - a[0].length);
  const taken: string[] = [];
  for (const [term, roles] of candidates) {
    // "data platform" and "platform" from the same roles: keep whichever came first.
    if (taken.some((t) => t.includes(term) || term.includes(t))) continue;
    taken.push(term);
    const wouldHide = matches.filter((m) => !m.nearMiss && !feedback[m.id] && words(m.title).join(' ').includes(term)).length;
    out.push({
      id: `title:${term}`,
      text: `Skip titles containing “${term}”?`,
      why: `You passed on ${plural(roles.length, 'role')} with “${term}” in the title and starred none.${wouldHide ? ` It would also clear ${plural(wouldHide, 'role')} waiting in your inbox and Discover.` : ''}`,
      evidence: roles,
      criteria: { ...c, titles: { include: c.titles?.include ?? [], exclude: [...(c.titles?.exclude ?? []), term] } },
    });
    if (taken.length === 3) break;
  }

  // 2. Roles under your pay floor that you starred anyway: maybe the floor's too high.
  for (const [currency, floor] of Object.entries(c.comp_floor ?? {})) {
    const under = matches.filter((m) => m.nearMiss === 'pay' && m.comp?.currency === currency && feedback[m.id]?.verdict === 'interested');
    if (under.length < MIN_EVIDENCE) continue;
    const lower = roundDown(Math.min(...under.map((m) => m.comp!.max)), 5000);
    if (lower >= floor || lower <= 0) continue;
    const label = (n: number) => money({ min: n, max: n, currency }).split('–')[0];
    out.push({
      id: `pay:${currency}:${lower}`,
      text: `Lower your ${currency} pay floor from ${label(floor)} to ${label(lower)}?`,
      why: `You starred ${plural(under.length, 'role')} that your floor had hidden as near misses.`,
      evidence: under.map((m) => `${m.title} at ${m.company} (${money(m.comp!)})`),
      criteria: { ...c, comp_floor: { ...c.comp_floor, [currency]: lower } },
    });
  }

  // 3. Roles past your age limit that you starred anyway.
  const old = matches.filter((m) => m.nearMiss === 'age' && feedback[m.id]?.verdict === 'interested');
  if (c.max_age_days && old.length >= MIN_EVIDENCE) {
    const days = c.max_age_days * 2;
    out.push({
      id: `age:${days}`,
      text: `Raise your age limit from ${c.max_age_days} to ${days} days?`,
      why: `You starred ${plural(old.length, 'role')} that were older than your limit.`,
      evidence: old.map((m) => `${m.title} at ${m.company}`),
      criteria: { ...c, max_age_days: days },
    });
  }

  // 4. A company on your list where you pass on everything.
  for (const w of watches) {
    const here = (v: { company: string }) => v.company.toLowerCase() === w.name.toLowerCase();
    const no = passed.filter(here);
    if (no.length < MIN_EVIDENCE + 1 || starred.some(here)) continue;
    out.push({
      id: `watch:${w.id}`,
      text: `Stop watching ${w.name}?`,
      why: `You've passed on all ${no.length} of its roles you decided on.`,
      evidence: no.map((v) => `${v.title}${v.reason ? ` (“${v.reason}”)` : ''}`),
      removeWatch: { id: w.id, name: w.name },
    });
  }

  // 5. An industry you keep passing on in Discover (the VC boards say which industry each company is in).
  const skipping = (c.discover?.skip_industries ?? []).map((s) => s.toLowerCase());
  const industryOf = (list: typeof passed) => {
    const m = new Map<string, string[]>();
    for (const v of list) for (const ind of new Set(byId.get(v.id)?.industries ?? [])) m.set(ind, [...(m.get(ind) ?? []), `${v.title} at ${v.company}`]);
    return m;
  };
  const starredIndustries = industryOf(starred);
  const worst = [...industryOf(passed)]
    .filter(([ind, roles]) => roles.length >= MIN_EVIDENCE && !starredIndustries.has(ind) && !skipping.some((s) => ind.toLowerCase().includes(s)))
    .sort((a, b) => b[1].length - a[1].length)[0];
  if (worst) {
    const [industry, roles] = worst;
    out.push({
      id: `industry:${industry.toLowerCase()}`,
      text: `Skip ${industry} companies in Discover?`,
      why: `You passed on ${plural(roles.length, 'Discover role')} at ${industry} companies and starred none. Companies on your list aren't affected.`,
      evidence: roles,
      criteria: { ...c, discover: { ...c.discover, skip_industries: [...(c.discover?.skip_industries ?? []), industry.toLowerCase()] } },
    });
  }

  return out.filter((s) => !dismissed.has(s.id));
}

/** Your filters with one more suggestion marked as dismissed (the last 100 are remembered). */
export function dismiss(c: Criteria, id: string): Criteria {
  return { ...c, dismissed_suggestions: [...new Set([...(c.dismissed_suggestions ?? []), id])].slice(-100) };
}
