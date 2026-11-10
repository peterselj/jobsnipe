-- Teams: roles on a watched team show up even when their title isn't in your list.
-- Run once in Supabase → SQL Editor, BEFORE merging the PR that adds this file (the checker writes
-- these columns as soon as it's merged; the current checker ignores them).

-- The department and team a board files a job under, e.g. "Commercial / Commercial Products".
alter table public.postings add column team text;

-- Which version of the readers last read a board in full. A board behind the current version is
-- read once even if it hasn't changed, so the jobs already stored get their teams.
alter table public.companies add column reader_version int not null default 0;

-- A near miss can now be "title": everything else fits, the title isn't listed, the team is watched.
alter table public.matches drop constraint matches_near_miss_check;
alter table public.matches add constraint matches_near_miss_check
  check (near_miss in ('title', 'seniority', 'location', 'pay', 'age'));
