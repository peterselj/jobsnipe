-- Tidy the Archive. Run once in Supabase → SQL Editor, BEFORE merging the PR that needs it. Safe with
-- the code already live: it only adds a column and a function.

-- Deleting a role from the Archive keeps a hidden note (deleted_at) instead of removing the row: the
-- row is how JobSnipe remembers you've seen a job, and without it a job still posted would come back
-- to your inbox on the next check.
alter table public.verdicts add column deleted_at timestamptz;

-- The hidden notes go once they can't matter: deleted at least 90 days ago and the job is no longer
-- posted anywhere JobSnipe reads (closed on its board, or not seen on a VC board for two days).
-- Called by the checker each run.
create function public.prune_deleted_verdicts() returns void
language sql security definer set search_path = '' as $$
  delete from public.verdicts v
   where v.deleted_at < now() - interval '90 days'
     and not exists (select 1 from public.postings p where p.id = v.posting_id and p.closed_at is null)
     and not exists (select 1 from public.discover_postings d where d.id = v.posting_id and d.last_seen_at > now() - interval '2 days');
$$;
revoke execute on function public.prune_deleted_verdicts() from public, anon, authenticated;
grant execute on function public.prune_deleted_verdicts() to service_role;
