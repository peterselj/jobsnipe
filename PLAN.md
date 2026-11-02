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

## Next up: coverage (Phase 3, reshaped)

Two lanes, kept apart so breadth never costs speed:

| | **Your list** (fast lane) | **Discover** (new) |
|---|---|---|
| What | Companies you chose | Everything else that passes all your filters |
| Checked | Hourly | Hourly or daily, depending on the source |
| Alerts | Instant email per match | Digest: daily or weekly (your choice), or off |
| On the page | Inbox | A Discover tab, labelled with where it came from ("via Sequoia") |

A Discover match has a **Watch this company** button: it finds the company's own board and moves it
to your list, so from then on you hear within the hour. Discover skips companies already on your
list, shows no near misses (there would be hundreds), and the same job seen in two places is shown
once.

### Sources, in build order

1. **Discover foundation + VC portfolio boards (Getro).** Most VC job boards (a16z, Sequoia, General
   Catalyst, Khosla, Lightspeed, Thrive, Bessemer, Felicis, Lux...) run on Getro or Consider; one
   reader per platform covers most of them. Start with 2-3 VCs to gauge noise. Includes the digest
   email, its setting, and Watch this company. These boards copy jobs from company boards about a
   day late, which is fine for Discover.
2. **Companies' own sites, the common systems.** Readers for Workday (most big companies),
   SmartRecruiters and Workable, all with public job lists; Find board learns to spot them. These are
   fast-lane boards like Greenhouse: hourly, instant emails.
3. **Consider** (the rest of the VC boards) and the **YC company directory** (public; lists who's
   hiring and their sites, so YC companies can be found on their Ashby/Lever/Greenhouse boards
   without logging in to Work at a Startup).
4. **Custom career pages.** Many pages describe each job in a hidden, standard format (schema.org
   JobPosting, which Google for Jobs requires); read that first. For pages without it, check the page
   for changes and have AI pull the jobs out. AI needs an Anthropic API key; a small model reading a
   few pages a day costs a few dollars a month at most.
5. **Email lane.** A JobSnipe inbox that you forward job-alert emails to, or set them to arrive at:
   Wellfound, LinkedIn, YC's Work at a Startup, and newsletters (Ali Rohde, next play, a16z Jobs,
   Nonlinear). AI pulls out the jobs, your filters decide, matches go to Discover. Plus HN "Who's
   Hiring" (one thread a month, read through its public search API).

**Why Wellfound and Work at a Startup go through email, not direct reading:** Wellfound blocks
automated reading and its terms forbid it; Work at a Startup needs a login, and automating your
account risks getting it banned. Both send job-alert emails you control, which is allowed and gets
the same jobs.

**Skipped:** fellowships (college and early career).

## Later

- **Scoring (rest of Phase 2).** AI rubric: tier, fit reason, flags, open questions. Each cue is a
  separate optional field so any that feel cheesy or redundant can be switched off.
- **Alert batching** for your list too (the Discover digest builds the daily/weekly email).
- **Teamtailor, iCIMS** and other less common systems, if companies you want use them.
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
- **Phase 5.** Confirm each new email address with a link before alerting it; weekly rubric-revision
  proposals from feedback; "Send to JobBoard".
- **Text alerts** for people who prefer them (ntfy or Twilio).
