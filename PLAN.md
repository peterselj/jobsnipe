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

## Near misses: where they can go

A near miss is a role in your job family (title fits) that failed exactly **one** other check: pay,
place or level. Two or more misses is noise; title misses are the wrong job. They're never emailed.

Places they can surface, and what's built:

1. **A Near misses tab** next to Inbox / Interested / Not for me, with chips per reason (Pay · Place ·
   Level) and "★ Interested anyway". *Built.*
2. **Next to each filter in Settings**, as the cost of that filter: "Your floor is hiding 3 roles (…)",
   "Places hiding the most roles: San Francisco (18)", "Senior-and-up is hiding 2". *Built.*
3. **What-if previews while editing:** type a lower pay floor and see "At $130K, 2 of those would show
   up". *Built for pay.* Places could do the same ("Adding San Francisco would add 18").
4. **A line in a weekly email:** "Your pay floor hid 2 roles this week." Fits with alert batching.
5. **Learning from verdicts:** if you keep marking pay near misses Interested, suggest lowering the
   floor (pairs with the Phase 5 rubric-revision idea).
6. **Per company:** a company's near misses can suggest a per-company filter ("Anthropic: 12 NYC near
   misses, 0 Toronto").

## Next

- **Scoring (rest of Phase 2).** AI rubric: tier, fit reason, flags, open questions. Each cue is a
  separate optional field so any that feel cheesy or redundant can be switched off.
- **Alert batching.** Immediate / hourly / daily / weekly, once immediate gets noisy.
- **Slow lane (Phase 3).** Re-screen LinkedIn job-alert emails with your own filters; one or two
  aggregators; Teamtailor and other boards the checker can't read yet; de-duplication.
- **Built (Oct 27):** pause alerts, delete account, per-company filters (e.g. "Toronto only at this
  company", "skip titles with technical here"), near misses (above), and leaner hourly checks
  (unchanged boards cost almost nothing; only changes are written).
- **Built (Oct 27, later):** Archive (from any folder, keeps your decision, never resurfaces) and an
  age limit ("skip roles posted more than N days ago"; older ones become Age near misses).
  Then "Archive all" on each folder (one save for the whole list, keeps each role's decision).
- **Built (Nov 2):** "posted" means when a job went public. Lever only gives the date a job was
  created (Waabi's Creative Director: created Oct 29, published Nov 2, emailed within the hour but
  labelled "4d ago"). A board date earlier than our last look is replaced by when we first saw the
  job, for the label and the age limit. Checks stay hourly.
- **Built (Nov 3): Discover, first source.** VC portfolio boards on Getro (General Catalyst, Khosla,
  Accel, Thrive, Lux): read every 4 hours, searched by your job titles (about 2,250 product roles
  across the five), matched against all your filters, minus companies on your list. Discover tab with
  a chip per VC, "+ Watch company" (straight onto your list when the job links to a board we read,
  otherwise the finder opens), and a digest email: daily, weekly, every 2 weeks or never. Sequoia,
  a16z, Kleiner, Lightspeed, Bessemer and Felicis run on Consider: next.
- **Built (Nov 8):** Workday boards (pasted link only: Workday can't be found from a name or read by
  the page, so the checker reads it as soon as it's added). Reads the whole board 20 at a time, splits
  boards past Workday's 2,000-per-search cap by job category (NVIDIA: all 2,811), and reads a job's own
  page for its places and pay when its title fits someone. Also: a company's own careers-site link is
  turned into a name to try (careers.doordash.com → DoorDash, whose board is Greenhouse "doordashusa"),
  a `?gh_jid=` in it picks the board that has that job, and "usa"/"us" are tried as name endings.
- **More boards, next:** SmartRecruiters, Workable, Recruitee and BambooHR all have public job lists
  like Greenhouse's. Truly custom career sites (Google, Apple, Amazon, Meta) each need their own reader.
  The checker could also look inside a "not monitored" company's careers page for a board it links to.
- **Built (Nov 8): a tidier Archive.** Shows the last 30 days ("Show older" for the rest); Delete on
  each archived role and Empty archive. Deleting keeps a hidden note so the job never comes back to
  the inbox; notes go 90 days after deletion once the job is no longer posted.
- **Built (Nov 8): Discover clean-up.** Pay looked up on the company's own board when a VC board
  leaves it out (Imprint: $190K–$210K); the same job filed under two companies shown once (Salesforce's
  Slack jobs also listed as "Airkit"), with "links to salesforce" when the company and link disagree;
  a filter bar on every list tab (place, minimum pay, keywords with -word to hide, pay listed), and
  Archive all archives just what's in view.
- **Built (Nov 9, on a branch to try out): job-alert inbox.** Each person can get an address to point
  LinkedIn, Indeed, Wellfound and VC-board alerts at (the way to cover Consider boards: their search
  refuses outside requests). Jobs are read from the emails without AI (title link, then company and
  place); companies on your list that JobSnipe can't check directly go to the Inbox with an email,
  the rest to Discover. Newsletters need AI: later.
- **Phase 5.** Confirm each new email address with a link before alerting it; weekly rubric-revision
  proposals from feedback; "Send to JobBoard".
- **Text alerts** for people who prefer them (ntfy or Twilio).
