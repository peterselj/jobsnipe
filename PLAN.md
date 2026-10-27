# JobSnipe build plan

Living plan. Personal search details (target companies, filters) live in the database, never in this
public repo. The original spec and Phase 1 history are in the archived private `JobSnipe-backend` repo.

## Where things stand

- **Phase 1, fast lane (done).** Greenhouse, Lever and Ashby readers; diff against what's been seen;
  title, seniority, location, remote-scope and pay filters; one email per new match; a one-time
  "now watching" summary per company; broken-board alerts. Ran on GitHub Actions with state in a
  private repo.
- **Phase 2a, web page (done, being re-plumbed).** Matches with Interested / Not for me, companies
  panel with health, add-a-company search (company name or pasted job link), Check now, demo mode.
  Used a GitHub key to read and write the private repo; that was a stopgap and is being replaced.

## Now: Phase 4 foundation (moved ahead of scoring and the slow lane)

Goal: anyone (Jake first) uses JobSnipe with just an email address. No GitHub, no keys, no files.

| Piece | Choice |
|---|---|
| Database + sign-in | Supabase: email magic-link sign-in; Postgres with row-level security so each person sees only their own settings, matches and feedback |
| Checker | Same TypeScript checker, moved into this repo (`checker/`), run by GitHub Actions (free for public repos) |
| Timer | Supabase `pg_cron` starts the checker hourly (GitHub's own schedule skipped most runs); Check now uses the same path |
| Email | Brevo, fresh account just for JobSnipe, sending from Josh's domain. Also sends the sign-in emails |
| Web page | Same page, data source swapped from GitHub to Supabase |

Work items:
1. Database schema: profiles (filters as one JSON field so cues are easy to add or drop), companies
   and postings (shared, each board fetched once however many people watch it), watches (who follows
   which company), matches (per person), verdicts (Interested / Not for me + reason), alerts, runs.
2. Checker reads and writes Supabase; emails through Brevo.
3. Page: sign-in screen; matches as an **inbox** (Inbox = not yet decided, ending in "No new roles,
   you're all caught up"; Interested; Not for me, hidden by default); companies panel; **settings page**
   for filters and alert email; adding a company runs a real check immediately.
4. Move Josh's current profile and companies into the database; archive `JobSnipe-backend`.

## Next

- **Scoring (rest of Phase 2).** AI rubric: tier, fit reason, flags, open questions. Each cue is a
  separate optional field so any that feel cheesy or redundant can be switched off.
- **Alert batching.** Immediate / hourly / daily / weekly, once immediate gets noisy.
- **Slow lane (Phase 3).** Re-screen LinkedIn job-alert emails with your own filters; one or two
  aggregators; Teamtailor and other boards the checker can't read yet; de-duplication.
- **Phase 5.** Confirm each new email address with a link before alerting it; weekly rubric-revision
  proposals from feedback; "Send to JobBoard".
- **Text alerts** for people who prefer them (ntfy or Twilio).
