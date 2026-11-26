-- Remembers the "can't be checked" email per person and board. Run once in Supabase → SQL Editor,
-- BEFORE merging the PR that needs it. Safe with the code already live: it only adds a column the
-- current code doesn't read. Safe to run twice ("if not exists").
--
-- Until now the email was only remembered per board, and only once it had reached everyone watching
-- that board. If one send failed, nothing was remembered, so everyone it had reached got it again
-- every hour. A watch is one person following one board, which is exactly what needs remembering.
-- To undo: alter table public.watches drop column failure_alerted_at;

alter table public.watches
  -- When this person was last emailed that this board can't be checked. It counts for the current
  -- failure streak if it is later than the board's last good check (companies.last_ok_at).
  add column if not exists failure_alerted_at timestamptz;
