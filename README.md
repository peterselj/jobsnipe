# ◎ JobSnipe

**https://peterselj.github.io/jobsnipe/** · [try the demo](https://peterselj.github.io/jobsnipe/?demo)

JobSnipe checks your target companies' job boards every hour and emails you the moment a role
that fits is posted, so you can be one of the first applicants. This repo is the web page; the
hourly checker, your profile, and your data live in a separate private repo.

## What the page does

- **Matches:** roles at your companies that pass your filters right now, with what's new since your
  last visit at the top. Mark each **Interested** or **Not for me** (with an optional reason); the
  feedback is saved to your repo to tune scoring later.
- **Companies:** every company you watch, which job board it posts on, and whether that board is
  healthy. Add a company by name or by pasting any of its job links (the page searches Greenhouse,
  Lever, and Ashby directly), change a company's board, or remove it.
- **Check now:** runs the hourly check immediately instead of waiting.

## How it connects

There is no JobSnipe server. The page talks to two things straight from your browser:

- **Your private backend repo on GitHub**, using a fine-grained access key you paste once (it stays
  in your browser). It reads `web/<profile>.json` from the `state` branch, edits
  `profiles/<profile>.yaml` on `main`, writes `feedback/<profile>.json` to the `feedback` branch,
  and starts the `fast-lane.yml` workflow.
- **Public job-board APIs** (Greenhouse, Lever, Ashby) to find a company's board.

The key needs, for the backend repo only: **Contents** read and write, **Actions** read and write.

## Development

```
npm install
npm run dev      # http://localhost:5173/jobsnipe/  (add ?demo for sample data)
npm test
npm run build
```

Pushes to `main` publish to GitHub Pages. Stack: Vite, React, TypeScript, Tailwind CSS. The look
is JobBoard's (`src/index.css` and `src/components/ui.tsx` are adapted from
[JobBoard](https://github.com/peterselj/JobBoard)).
