-- One-time fix for posting dates already stored. Run once in Supabase → SQL Editor, any time
-- (before or after merging; safe to run twice).
--
-- Some boards (Lever) only give the date a job was created, which can be days before it was
-- published. The checker now corrects this as it finds new jobs; this fixes the ones it already has.
-- A job first seen well after its board's first read, whose board date is more than two hours
-- before that (so an hourly check would have seen it if it had been public), went public when we
-- first saw it.
update public.postings p
set ats_posted_at = p.first_seen_at
from (select company_id, min(first_seen_at) as first_read from public.postings group by company_id) b
where b.company_id = p.company_id
  and p.first_seen_at > b.first_read + interval '1 hour'
  and p.ats_posted_at < p.first_seen_at - interval '2 hours';
