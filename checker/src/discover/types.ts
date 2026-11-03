import { createHash } from "node:crypto";
import type { Ats } from "../types.js";

/** A job found on a VC portfolio board, for Discover. */
export interface DiscoverJob {
  id: string;
  company: string;
  title: string;
  locations: string[];
  workplace?: "remote" | "hybrid" | "onsite";
  url: string;
  postedAt?: string;
  comp?: { min: number; max: number; currency: string };
  /** The company's own board, when the job's link points at one JobSnipe can read. */
  ats?: Ats;
  board?: string;
  /** Which VC boards list it. */
  via: string[];
  firstSeenAt?: string;
}

export interface DiscoverSourceRow {
  id: number;
  kind: "getro";
  host: string;
  name: string;
  collection_id: string | null;
  enabled: boolean;
  last_checked_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  open_postings: number | null;
}

/** The same job is often on several VC boards; its own link identifies it. */
export function discoverId(url: string): string {
  let key = url.trim();
  try {
    const u = new URL(key);
    key = `${u.hostname.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    // keep the raw link
  }
  return `d:${createHash("sha1").update(key).digest("hex").slice(0, 16)}`;
}
