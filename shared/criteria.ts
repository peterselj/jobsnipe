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
}
