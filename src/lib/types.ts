export type Ats = 'greenhouse' | 'lever' | 'ashby';

/** A person's filters; same shape as `Criteria` in checker/src/types.ts (stored in profiles.criteria). */
export interface Criteria {
  titles?: { include?: string[]; exclude?: string[] };
  seniority?: { require?: string[]; unlevelled_pay_min?: number };
  locations?: { name: string; match: string[] }[];
  remote?: { allowed?: boolean; countries?: string[] };
  comp_floor?: Record<string, number>;
}

export interface Profile {
  id: string;
  name: string;
  email: string;
  criteria: Criteria;
  alert_mode: string;
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
