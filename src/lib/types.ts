/** Mirrors `WebView` in jobsnipe-backend/src/webview.ts (the file the hourly job writes). */
export interface WebView {
  version: 1;
  profile: { id: string; name: string };
  generatedAt: string;
  lastRun?: { at: string; newPostings: number; alertsSent: number; errors: number };
  matches: Match[];
  companies: CompanyHealth[];
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
  alertedAt?: string;
}

export type Ats = 'greenhouse' | 'lever' | 'ashby';

export interface CompanyHealth {
  name: string;
  ats: Ats | 'none';
  board?: string;
  boardUrl?: string;
  careersUrl?: string;
  note?: string;
  status: 'ok' | 'failing' | 'pending' | 'unmonitored';
  openPostings?: number;
  lastCheckedAt?: string;
  lastOkAt?: string;
  lastError?: string;
}

/** A company entry as written in profiles/<id>.yaml. */
export interface CompanyConfig {
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
  // Kept so feedback still reads sensibly after the posting closes.
  company: string;
  title: string;
}

/** feedback/<profile>.json on the backend's `feedback` branch, keyed by posting id. */
export type Feedback = Record<string, Verdict>;

export interface RunStatus {
  status: 'queued' | 'in_progress' | 'completed' | string;
  conclusion?: string | null;
  createdAt: string;
  url: string;
}
