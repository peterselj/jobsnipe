-- Indexes for lookups that had none. Run once in Supabase → SQL Editor, BEFORE merging the PR that
-- needs it. Safe with the code already live: an index only makes existing queries faster, nothing
-- reads or writes differently. Safe to run twice ("if not exists").
-- To undo: drop index public.matches_posting_idx, public.discover_matches_posting_idx,
--          public.inbound_emails_profile_received_idx, public.check_requests_by_at_idx,
--          public.alerts_sent_idx;

-- Deleting a posting also deletes its matches (on delete cascade), and the hourly prune deletes
-- postings. Both tables' primary keys start with profile_id, so without these each deleted posting
-- meant reading the whole table to find its matches.
create index if not exists matches_posting_idx on public.matches (posting_id);
create index if not exists discover_matches_posting_idx on public.discover_matches (posting_id);

-- receive_inbound_email counts one person's emails from the last day (the 200-a-day cap).
create index if not exists inbound_emails_profile_received_idx on public.inbound_emails (profile_id, received_at);

-- "Check now" counts one person's recent requests (20 an hour); the prune deletes by date.
create index if not exists check_requests_by_at_idx on public.check_requests (requested_by, requested_at);

-- The hourly prune deletes alerts older than 90 days.
create index if not exists alerts_sent_idx on public.alerts (sent_at);
