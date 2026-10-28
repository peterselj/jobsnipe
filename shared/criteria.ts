/**
 * A person's filters, stored as JSON in profiles.criteria: written by the page's Settings,
 * read by the checker. Every field is optional so filters can be added or dropped without a migration.
 */
export interface Criteria {
  titles?: { include?: string[]; exclude?: string[] };
  /** Title must show one of `require`; or, with no level at all, listed pay must start at `unlevelled_pay_min`. */
  seniority?: { require?: string[]; unlevelled_pay_min?: number };
  locations?: { name: string; match: string[] }[];
  remote?: { allowed?: boolean; countries?: string[] };
  /** Minimum acceptable top-of-range per currency. Postings without a listed range pass. */
  comp_floor?: Record<string, number>;
  /** Skip roles posted longer ago than this many days. Unset = any age. */
  max_age_days?: number;
}

/**
 * Per-company tweaks to someone's filters (watches.filters), e.g. "Toronto only at this company".
 * Anything left out falls back to the person's usual filters.
 */
export interface WatchFilters {
  /** Replaces the usual places for this company. */
  locations?: { name: string; match: string[] }[];
  /** Replaces the usual remote setting for this company. */
  remote?: { allowed?: boolean; countries?: string[] };
  /** Extra title words to skip at this company, on top of the usual ones. */
  exclude_titles?: string[];
}

/** The filters that apply to one company: the person's usual ones with that company's tweaks. */
export function withWatchFilters(c: Criteria, w: WatchFilters | null | undefined): Criteria {
  if (!w) return c;
  return {
    ...c,
    locations: w.locations ?? c.locations,
    remote: w.remote ?? c.remote,
    titles: { ...c.titles, exclude: [...(c.titles?.exclude ?? []), ...(w.exclude_titles ?? [])] },
  };
}

/** A short description of a company's tweaks, e.g. "Toronto area only · skips technical". */
export function describeWatchFilters(w: WatchFilters | null | undefined): string | undefined {
  if (!w) return undefined;
  const parts: string[] = [];
  if (w.locations || w.remote) {
    const places = (w.locations ?? []).map((l) => l.name);
    if (w.remote?.allowed) places.push('remote');
    parts.push(places.length ? `${places.join(', ')} only` : 'no places');
  }
  if (w.exclude_titles?.length) parts.push(`skips ${w.exclude_titles.join(', ')}`);
  return parts.join(' · ') || undefined;
}
