# JobSnipe: where it stands and where it's going

Living plan. Personal search details (target companies, filters) live in the database, never in this
public repo. Rewritten Nov 10 after a full review; the history of how each piece came about is in the
merged pull requests.

## What JobSnipe is

It tells you about new roles that fit, fast, and keeps the pile manageable. Two lanes, kept apart so
breadth never costs speed:

| | **Your list** (fast lane) | **Discover** |
|---|---|---|
| What | Companies you chose | Everything else that passes all your filters |
| Read from | Each company's own board: Greenhouse, Lever, Ashby, Workday, SmartRecruiters, Recruitee | VC portfolio boards (Getro); your job-alert emails |
| Checked | Hourly | Every 4 hours; emails hourly |
| Alerts | One email per new match | A digest: daily, weekly, every 2 weeks or never |
| On the page | Inbox | Discover tab, labelled with where each role came from |

How it runs: the page (GitHub Pages) signs people in and reads their data from Supabase, where
row-level security keeps each person to their own. A timer in Supabase starts the checker (a GitHub
Action) hourly; it reads the boards, saves what changed, and emails through Brevo. Setup:
`docs/SETUP.md`.

## Built

- **Matching.** Titles (include / exclude), senior-and-up, places and remote by country, pay floor
  per currency, age limit, and per-company tweaks ("Toronto only at this company"). Roles are dated
  by when they went public, not when they were drafted.
- **Inbox flow.** Inbox → ★ Interested / Not for me (with a reason) → Archive. Archive all, a filter
  bar (place, minimum pay, keywords, pay listed), an Archive that shows the last 30 days, delete and
  empty. Handled roles never come back, and a role re-listed under a new id is flagged as a repost
  and not emailed again.
- **Near misses.** Roles in your job family that failed exactly one filter, with what each filter is
  costing shown in Settings and a what-if for the pay floor. Settings also warns when a title entry
  is a level word by itself ("director"), which matches every such role in any field.
- **Discover.** Five VC boards on Getro (General Catalyst, Khosla, Accel, Thrive, Lux). Pay looked
  up on the company's own board when the VC board leaves it out; the same job filed under two
  companies shown once; "+ Watch company" moves a company to your list. Discover-only filters skip
  the industries and company stages you name (the VC boards say both).
- **Suggestions.** Patterns in your ★ Interested and Not for me decisions become offers at the top
  of Settings: skip a word that's in three titles you passed on, lower the pay floor after three
  starred pay near misses, widen the age limit, stop watching a company you always pass on, skip a
  Discover industry. Each shows the roles it's drawn from; nothing changes until you accept, and a
  dismissed one stays dismissed.
- **Roles you find yourself.** "+ Add role" (paste any job link: LinkedIn, a referral, anywhere) and
  a "Save to JobSnipe" bookmark that fills it in from the page you're on.
- **Job-alert inbox** (needs one-time setup, `docs/SETUP.md` section 5). An address per person for
  LinkedIn, Indeed, Wellfound and VC-board alerts; jobs are read from the emails without AI.
- **Tailor resume.** On Interested roles: copies the posting's text (Greenhouse, Lever, Ashby) and
  hands off to ResumeMachine, which tailors your resume in your own AI assistant.
- **Looking after itself.** Unchanged boards cost almost nothing; a broken board emails you after
  two failed hours; a Discover failure never holds up your list; pause alerts; delete account. A
  heartbeat on GitHub's own clock fails (and GitHub emails the owner) if no check has finished in
  three hours, or if only the 3-hourly backup is starting them.

## Security: what's guarded, and what to keep an eye on

Reviewed Nov 10. Fixed then:

- **The check workflow ran outside text as shell code.** "Check now" forwarded a reason from the
  signed-in person, and the workflow pasted it into a command next to the Supabase and Brevo keys.
  It now arrives as a variable, and the database only ever sends two fixed reasons.
- **Alerts could be pointed at anyone.** The alert address now follows the sign-in address, which
  only changes after a confirmation link is clicked.
- **Links could carry code.** Job links come from boards, VC boards and emails; only http(s) ones
  are kept or made clickable (checker, emails, page and database each check), and the page ships a
  content security policy as a backstop.
- **No limits.** Now: 150 companies and 12 title searches per person, 20 checks an hour, 20,000 saved
  roles, and size caps on filters and text.
- **The email inbox's door was open.** The function that receives job-alert emails only accepts
  requests carrying a key the database made; nobody copies it anywhere.

Still worth knowing:

- **Anyone can sign up.** The page is public and sign-up is open, so a stranger can use your
  GitHub Actions minutes and Brevo quota within the limits above. To make it invite-only: Supabase →
  Authentication → Sign In / Providers → turn off "Allow new users to sign up", then invite people
  from Authentication → Users. No code change needed.
- **The repo and its Actions logs are public.** Logs name boards by number only, and errors have
  links and addresses stripped. Keep it that way when adding log lines.
- **Brevo's free plan caps daily sends.** A burst (a big first digest, many broken boards) could hit
  it; sends that fail are retried the next hour.
- **If the hourly timer stops,** the Heartbeat workflow fails and GitHub emails you, as long as
  GitHub → Settings → Notifications → Actions has email on for failed workflows (it is by default).

## Roadmap

Next, in the order I'd do them:

1. **Prove the job-alert inbox on real emails.** Do the one-time setup, point a LinkedIn alert at it,
   and tune the reader to whatever "no jobs found" turns up. This is how LinkedIn, Indeed and the
   Consider VC boards (Sequoia, a16z, Kleiner, Lightspeed, Bessemer, Felicis) get covered.
2. **Send to JobBoard** on Interested roles: opt-in per person (off by default), built as a draft in
   both repos so the handoff can be tried before it's committed to.
3. **More company boards:** Workable (its job feed couldn't be confirmed on Nov 10: the test
   accounts had no open jobs), BambooHR, and the standard job details many careers pages embed for
   Google. SmartRecruiters and Recruitee are done.
4. **Posted-within-N-days for Discover**, separate from your list's age limit.

Later:

- **AI reading** (needs an Anthropic API key; a small model, a few dollars a month): newsletters in
  the job-alert inbox (Ali Rohde, next play, a16z Jobs), HN "Who's Hiring", and a fit score with a
  one-line reason per role.
- **Portfolio lists.** For VCs whose boards can't be read, take their public list of companies and
  find each company's own board, which is faster than any VC board anyway.
- **A weekly review email:** what came in, what you did with it, what your filters hid.
- **Batching for your list** (hourly / daily) if single emails get noisy; text alerts.

Decided against, and why:

- **Reading LinkedIn, Indeed, Wellfound or Work at a Startup directly.** Their terms forbid it, they
  block it, and for sites you log in to it puts your account at risk. Their job-alert emails and the
  "Save to JobSnipe" bookmark cover the same ground with your own hands on the wheel.
- **Reading Consider boards' search directly.** It refuses requests that don't come from its own
  page. Their alert emails go to the inbox instead.
- **Filters that change themselves.** If JobSnipe quietly learned "skip fintech" from three clicks,
  it could hide the one role you wanted and you'd never know. Suggestions you approve only.
- **Showing both "created" and "posted" dates.** Only when a role went public is something to act on.
