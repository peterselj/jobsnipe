import type { Ats } from "../../shared/ats.js";
import type { Criteria, WatchFilters } from "../../shared/criteria.js";

export type { Ats, Criteria, WatchFilters };

/** Criteria with defaults filled in and terms lowercased, ready for the filters. */
export interface Filters {
  titles: { include: string[]; exclude: string[] };
  seniority?: { require: string[]; unlevelled_pay_min?: number };
  locations: { name: string; match: string[] }[];
  remote: { allowed: boolean; countries: string[] };
  comp_floor: Record<string, number>;
  max_age_days?: number;
}

export interface Person {
  id: string;
  name: string;
  email: string;
  criteria: Criteria;
  alert_mode: "immediate" | "hourly" | "daily" | "weekly";
  /** Matches keep updating but no email is sent. */
  alerts_paused?: boolean;
  /** How often the Discover digest comes ("never" = page only), and when the last one went. */
  digest_every?: "daily" | "weekly" | "biweekly" | "never";
  last_digest_at?: string | null;
}

/** A posting as normalized from any ATS. */
export interface Posting {
  id: string; // `${ats}:${board}:${externalId}`
  source: Ats;
  companyKey: string; // `${ats}:${board}`
  company: string;
  title: string;
  locations: string[];
  workplace?: "remote" | "hybrid" | "onsite";
  url: string;
  atsPostedAt?: string;
  comp?: { min: number; max: number; currency: string };
  /** False when the board's list leaves pay out and we haven't fetched this posting's details yet. */
  compChecked?: boolean;
  /** The list's places are only a stand-in ("3 locations"); the job's details have the real ones. */
  locationsFromDetails?: boolean;
}

/** What a posting's own page adds, for boards whose list leaves things out. */
export interface Details {
  comp?: Posting["comp"];
  locations?: string[];
  workplace?: Posting["workplace"];
}

/**
 * One board check: its postings and version tag, or "unchanged since that tag". `partial` means
 * the board was too big to read in full, so postings missing from it may still be open.
 */
export type BoardResult = { unchanged: true } | { unchanged?: false; postings: Posting[]; etag?: string; partial?: boolean };

export type Check = "title" | "seniority" | "location" | "pay" | "age";

export interface FilterResult {
  pass: boolean;
  /** Why it failed (empty when it passed). */
  reasons: string[];
  /** Which checks failed, with the reason for each; drives near misses. */
  failed: { check: Check; detail: string }[];
  /** Soft warnings shown alongside a passing posting. */
  flags: string[];
  /** Which configured area or remote scope matched. */
  where?: string;
}
