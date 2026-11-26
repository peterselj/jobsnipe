import { parseArgs } from "node:util";
import { makeMailer } from "./email.js";
import { backupNotNeeded, BACKUP_SKIP_WITHIN_MINUTES, runCheck } from "./run.js";
import { SupabaseStore } from "./store.js";

const { values } = parseArgs({
  options: {
    trigger: { type: "string", default: "manual" },
    "dry-run": { type: "boolean", default: false },
  },
});

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  // Not set up yet (docs/SETUP.md): skip quietly rather than fail the backup schedule every 3 hours.
  console.log("SUPABASE_URL / SUPABASE_SECRET_KEY not set; nothing to check yet.");
  process.exit(0);
}

const store = new SupabaseStore(url, key);
if (await backupNotNeeded(store, values.trigger)) {
  // Before anything is written: a skipped backup leaves no row in `runs` and fetches no boards.
  console.log(`JobSnipe check (${values.trigger}) · a run finished in the last ${BACKUP_SKIP_WITHIN_MINUTES} minutes, so the hourly timer is working; nothing to do.`);
  process.exit(0);
}

const mailer = makeMailer(process.env, { dryRun: values["dry-run"] });
// No sender address here: this log is public (see redact in run.ts).
console.log(`JobSnipe check (${values.trigger}) · ${mailer.describe.startsWith("Brevo") ? "sending through Brevo" : mailer.describe}`);

const run = await runCheck({ store, mailer, trigger: values.trigger, log: console.log });
console.log(`done: ${run.companies_checked} boards, ${run.new_postings} new postings, ${run.alerts_sent} emails, ${run.errors.length} errors`);
for (const e of run.errors) console.log(`error: ${e}`);
// Broken boards are reported by email; only a failed send should fail the job (GitHub then emails the repo owner).
if (run.errors.some((e) => e.includes("email"))) process.exitCode = 1;
