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
}

/** One board check: its postings and version tag, or "unchanged since that tag". */
export type BoardResult = { unchanged: true } | { unchanged?: false; postings: Posting[]; etag?: string };

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
