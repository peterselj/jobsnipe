# ◎ JobSnipe

**https://peterselj.github.io/jobsnipe/** · [take the 2-minute tour](https://peterselj.github.io/jobsnipe/?tour) · [try the demo](https://peterselj.github.io/jobsnipe/?demo)

JobSnipe checks your target companies' job boards every hour and emails you the moment a role
that fits is posted, so you can be one of the first applicants. Sign in with just your email.

## New here? Take the tour

[The tour](https://peterselj.github.io/jobsnipe/?tour) walks through a demo with made-up companies,
with spotlights and short steps: your list of companies, a new role arriving, deciding on it, Near
misses, Discover, adding a role yourself, filters and suggestions. Nothing is saved. It's also
offered on the sign-in page, in the demo's top bar, and to a new account before any filters are set.

## What it does

- **Inbox:** open roles at your companies that pass your filters. Mark each **★ Interested** or
  **Not for me** (with an optional reason) until the inbox reads "No new roles!". Interested roles
  stay listed even after the posting closes.
- **Companies:** add one by name or by pasting any of its job links (it searches Greenhouse, Lever
  and Ashby, and takes Workday links; a link to a company's own careers site is tried too, since many
  sit in front of one of these), fix or remove it, and see whether each board is being read OK.
- **Near misses:** roles in your job family that missed by just one filter (pay, place or level), with
  what each filter is hiding shown in Settings, so you can tell when to loosen one.
- **Settings:** job titles to include and exclude, senior-and-up, places, remote countries, pay floor,
  pause alerts, delete account. Any company can have its own tweaks (e.g. "Toronto only here").
- **Alerts:** one email per new match, a "now watching" summary when you add a company, and a
  warning if a company's board stops working.

## How it's built

```
 page (GitHub Pages) ──sign-in, read/write own data──▶ Supabase (Postgres + Auth)
                                                          │  hourly pg_cron, or "Check now"
                                                          ▼
                       GitHub Action "Check job boards" (checker/) ──▶ Greenhouse / Lever / Ashby / Workday
                                                          │
                                                          └──▶ Brevo ──▶ alert emails
```

- `src/`: the page (Vite, React, TypeScript, Tailwind; look adapted from
  [JobBoard](https://github.com/peterselj/JobBoard)).
- `checker/`: reads boards, applies each person's filters, saves postings and matches, sends email.
- `supabase/migrations/`: the database: tables, row-level security (each person sees only their own
  data), the hourly timer and the Check now path.
- [`docs/SETUP.md`](docs/SETUP.md): one-time setup of Supabase, Brevo and GitHub.
- [`PLAN.md`](PLAN.md): what's done and what's next.

No personal search details live in this repo; they're in the database.

## Development

```
npm install
npm run dev        # http://localhost:5173/jobsnipe/  (add ?demo for sample data)
npm test           # page, checker, and database tests (the database runs in-process via PGlite)
npm run build
npm run check -- --dry-run   # run the checker against Supabase, writing emails to out/ instead of sending
```

Pushes to `main` publish the page. The checker needs `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (and
`BREVO_API_KEY` + `MAIL_FROM` to send).
