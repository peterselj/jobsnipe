-- "Send to JobBoard" remembered per account instead of per browser, so turning it on once shows the
-- button on every device you sign in on. Run once in Supabase → SQL Editor, BEFORE merging the PR
-- that needs it. Safe with the code already live: it only adds a column (off for everyone).
-- To undo: alter table public.profiles drop column send_to_jobboard;

alter table public.profiles add column send_to_jobboard boolean not null default false;
grant update (send_to_jobboard) on public.profiles to authenticated;
