-- Privacy fix. Run once in Supabase → SQL Editor.
--
-- Before: every signed-in person could read the whole shared list of job boards and postings.
-- Each board is only in that list because someone watches it, so the list revealed everyone's
-- target companies. Now people can only read the boards (and their postings) they watch.

drop policy "read job boards" on public.companies;
create policy "read watched boards" on public.companies for select to authenticated
  using (exists (select 1 from public.watches w where w.company_id = companies.id and w.profile_id = (select auth.uid())));

drop policy "read postings" on public.postings;
create policy "read postings at watched boards" on public.postings for select to authenticated
  using (exists (select 1 from public.watches w where w.company_id = postings.company_id and w.profile_id = (select auth.uid())));

-- Run history stays readable (the page shows when the last check ran), but older runs stored
-- error text that could name a board. The checker no longer writes names; clear the old ones.
update public.runs set errors = '[]'::jsonb where errors <> '[]'::jsonb;
