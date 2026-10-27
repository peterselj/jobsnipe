# ◎ JobSnipe

**https://peterselj.github.io/jobsnipe/** · [try the demo](https://peterselj.github.io/jobsnipe/?demo)

JobSnipe checks your target companies' job boards every hour and emails you the moment a role
that fits is posted, so you can be one of the first applicants. Sign in with just your email.

## What it does

- **Inbox:** open roles at your companies that pass your filters. Mark each **★ Interested** or
  **Not for me** (with an optional reason) until the inbox reads "No new roles!". Interested roles
  stay listed even after the posting closes.
- **Companies:** add one by name or by pasting any of its job links (it searches Greenhouse, Lever
  and Ashby), fix or remove it, and see whether each board is being read OK.
- **Settings:** job titles to include and exclude, senior-and-up, places, remote countries, pay floor.
- **Alerts:** one email per new match, a "now watching" summary when you add a company, and a
  warning if a company's board stops working.

## How it's built

```
 page (GitHub Pages) ──sign-in, read/write own data──▶ Supabase (Postgres + Auth)
                                                          │  hourly pg_cron, or "Check now"
                                                          ▼
                       GitHub Action "Check job boards" (checker/) ──▶ Greenhouse / Lever / Ashby
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
