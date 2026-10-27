import type { Ats } from "../../shared/ats.js";
import type { Criteria } from "../../shared/criteria.js";

export type { Ats, Criteria };

/** Criteria with defaults filled in and terms lowercased, ready for the filters. */
export interface Filters {
  titles: { include: string[]; exclude: string[] };
  seniority?: { require: string[]; unlevelled_pay_min?: number };
  locations: { name: string; match: string[] }[];
  remote: { allowed: boolean; countries: string[] };
  comp_floor: Record<string, number>;
}

export interface Person {
  id: string;
  name: string;
  email: string;
  criteria: Criteria;
  alert_mode: "immediate" | "hourly" | "daily" | "weekly";
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
}

export interface FilterResult {
  pass: boolean;
  /** Why it failed (empty when it passed). */
  reasons: string[];
  /** Soft warnings shown alongside a passing posting. */
  flags: string[];
  /** Which configured area or remote scope matched. */
  where?: string;
}
