-- Archive, and an age limit for postings. Run once in Supabase → SQL Editor, BEFORE merging the PR
-- that needs it. Safe with the code already live: it only relaxes and adds.

-- Archive: done with a role, whatever you thought of it. archived_at keeps your Interested / Not for
-- me decision alongside; a role archived straight from the inbox has no decision (verdict null).
-- Verdicts are keyed by the posting's permanent id and outlive the posting, so an archived role
-- never comes back to the inbox.
alter table public.verdicts alter column verdict drop not null;
alter table public.verdicts add column archived_at timestamptz;
alter table public.verdicts add constraint verdicts_decided_or_archived
  check (verdict is not null or archived_at is not null);

-- Near misses can now also be "too old" (posted longer ago than the person's age limit).
alter table public.matches drop constraint matches_near_miss_check;
alter table public.matches add constraint matches_near_miss_check
  check (near_miss in ('seniority', 'location', 'pay', 'age'));
