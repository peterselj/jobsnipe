import type { Ats } from '../../shared/ats';
import type { Criteria, WatchFilters } from '../../shared/criteria';

export type { Ats, Criteria, WatchFilters };

export interface Profile {
  id: string;
  name: string;
  email: string;
  criteria: Criteria;
  alert_mode: string;
  alerts_paused: boolean;
}

export interface Match {
  id: string;
  company: string;
  title: string;
  url: string;
  where?: string;
  flags: string[];
  comp?: { min: number; max: number; currency: string };
  atsPostedAt?: string;
  firstSeenAt: string;
  /** Set for a near miss: the one check it failed, and why. */
  nearMiss?: 'seniority' | 'location' | 'pay';
  missDetail?: string;
}

/** A company someone follows, with how its board is doing. */
export interface Watch {
  id: number;
  name: string;
  ats: Ats | 'none';
  board?: string;
  careersUrl?: string;
  note?: string;
  status: 'ok' | 'failing' | 'pending' | 'unmonitored';
  openPostings?: number;
  lastCheckedAt?: string;
  lastError?: string;
  /** Tweaks to the usual filters for this company only. */
  filters?: WatchFilters;
}

/** What "Add company" produces. ats 'none' = list it without monitoring. */
export interface NewWatch {
  name: string;
  ats: Ats | 'none';
  board?: string;
  careers_url?: string;
  note?: string;
}

export interface Verdict {
  verdict: 'interested' | 'not_for_me';
  reason?: string;
  at: string;
  // Kept so a verdict still reads sensibly after the posting closes.
  company: string;
  title: string;
  url?: string;
}

/** Keyed by posting id. */
export type Feedback = Record<string, Verdict>;

export interface Run {
  startedAt: string;
  finishedAt?: string;
  trigger: string;
  errors: number;
}

export interface Snapshot {
  profile: Profile;
  watches: Watch[];
  matches: Match[];
  feedback: Feedback;
  lastRun?: Run;
}
