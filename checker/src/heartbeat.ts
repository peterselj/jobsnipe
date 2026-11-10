import { createClient } from "@supabase/supabase-js";

// The heartbeat: has the hourly check been running? Run on GitHub's own schedule (not the Supabase
// timer it's watching). When something's wrong it exits with an error, and GitHub emails the repo's
// owner about the failed run, so a silent stop gets noticed.

export interface RunRow {
  trigger: string;
  started_at: string;
  finished_at: string | null;
}

const HOUR = 3_600_000;
/** The check runs hourly, with GitHub's own 3-hourly schedule as a backup. */
export const STALE_AFTER_HOURS = 3;
/** How long the Supabase timer may be quiet while backup runs carry on. */
export const TIMER_QUIET_HOURS = 6;

/** What's wrong, in a sentence, or undefined when all's well. `runs` is the most recent first. */
export function heartbeatProblem(runs: RunRow[], now: Date): string | undefined {
  const finished = runs.filter((r) => r.finished_at);
  const last = finished[0];
  if (!last) return "No check has ever finished. See docs/SETUP.md, \"First run\".";
  const hoursSince = (iso: string) => (now.getTime() - Date.parse(iso)) / HOUR;
  if (hoursSince(last.finished_at!) > STALE_AFTER_HOURS) {
    return `No check has finished in ${Math.floor(hoursSince(last.finished_at!))} hours (the last one finished ${last.finished_at}). New roles aren't being found. Look at the latest "Check job boards" runs under Actions.`;
  }
  // Checks are finishing, but only GitHub's backup schedule is starting them: the Supabase timer
  // (or the key it uses to start a run) has stopped, and checks are 3-hourly instead of hourly.
  const lastTimer = finished.find((r) => r.trigger === "schedule" || r.trigger === "check now");
  if (!lastTimer || hoursSince(lastTimer.finished_at!) > TIMER_QUIET_HOURS) {
    return `Checks are only running on GitHub's 3-hourly backup: the Supabase timer hasn't started one in ${lastTimer ? `${Math.floor(hoursSince(lastTimer.finished_at!))} hours` : "a long time"}. Usually the GitHub token in Supabase Vault has expired (docs/SETUP.md, step 2).`;
  }
  return undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.log("SUPABASE_URL / SUPABASE_SECRET_KEY not set; nothing to watch yet.");
    process.exit(0);
  }
  const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await db.from("runs").select("trigger, started_at, finished_at").order("started_at", { ascending: false }).limit(40);
  if (error) {
    console.log(`::error::Couldn't read the run history: ${error.message}`);
    process.exit(1);
  }
  const problem = heartbeatProblem((data ?? []) as RunRow[], new Date());
  if (problem) {
    console.log(`::error::${problem}`);
    process.exit(1);
  }
  console.log("Heartbeat OK: the hourly check is running.");
}
