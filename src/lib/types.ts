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
  /** How often the Discover digest email comes. */
  digest_every: DigestEvery;
  /** Show "→ JobBoard" on Interested roles. Off unless this person turned it on. */
  send_to_jobboard: boolean;
  /** Show the Near misses tab. Off for new accounts until turned on. */
  near_misses_on: boolean;
  /** Discover (roles beyond your list, and its digest). Off for new accounts until turned on. */
  discover_on: boolean;
  /** A "still watching, nothing new" email after 30 days without one. */
  monthly_note: boolean;
  /** The first part of this person's job-alert inbox address; null when the inbox is off. */
  inbox_token?: string | null;
}

/** An email that arrived in someone's job-alert inbox. */
export interface InboxEmail {
  id: number;
  fromName?: string;
  fromAddress?: string;
  subject?: string;
  receivedAt: string;
  /** Unset until the hourly check has read it. */
  jobsFound?: number;
  text?: string;
}

export type DigestEvery = 'daily' | 'weekly' | 'biweekly' | 'never';

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
  nearMiss?: 'seniority' | 'location' | 'pay' | 'age';
  missDetail?: string;
  /** Set for Discover: passes your filters at a company you don't watch; which VC boards list it. */
  via?: string[];
  /** From your job-alert emails, at a company on your list JobSnipe can't check directly: an Inbox role. */
  onList?: boolean;
  /** Discover: what the VC board says about the company. */
  stage?: string;
  industries?: string[];
  /** The company's own board, when known (for "Watch this company"). */
  ats?: Ats;
  board?: string;
}

/** A VC portfolio job board Discover reads. */
export interface DiscoverSource {
  name: string;
  host: string;
  lastOkAt?: string;
  lastError?: string;
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
  /** Absent when a role was archived straight from the inbox without a decision. */
  verdict?: 'interested' | 'not_for_me';
  reason?: string;
  at: string;
  /** Set once you're done with the role; it then lives in the Archive. */
  archivedAt?: string;
  /** Deleted from the Archive: hidden everywhere, but still remembered so the job never comes back. */
  deletedAt?: string;
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
  discoverSources: DiscoverSource[];
  /** The latest emails in this person's job-alert inbox. */
  inboxEmails: InboxEmail[];
}
