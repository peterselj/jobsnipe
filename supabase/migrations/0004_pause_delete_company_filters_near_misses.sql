-- Pause alerts, delete account, per-company filters, near misses.
-- Run once in Supabase → SQL Editor, BEFORE merging the PR that needs it. Safe with the code
-- already live: it only adds columns and functions (and replaces sync_matches compatibly).

-- ───────────── Pause alerts ─────────────
-- While paused, matches keep updating on the page but no email is sent; roles found meanwhile are
-- marked as handled, so resuming doesn't send a pile of old alerts.
alter table public.profiles add column alerts_paused boolean not null default false;
grant update (alerts_paused) on public.profiles to authenticated;

-- ───────────── Per-company filters ─────────────
-- Optional tweaks to a person's filters for one company, e.g. {"locations": [<Toronto area>], "remote":
-- {"allowed": false}} for "Toronto only here", or {"exclude_titles": ["technical"]}. Shape: WatchFilters
-- in shared/criteria.ts. null = use the usual filters.
alter table public.watches add column filters jsonb;
create policy "change own watches" on public.watches for update to authenticated
  using (profile_id = (select auth.uid())) with check (profile_id = (select auth.uid()));
-- Only the filters column; the board a watch points at still changes through change_watch_board.
grant update (filters) on public.watches to authenticated;

-- ───────────── Near misses ─────────────
-- Roles in someone's job family that failed exactly one other check. Stored alongside matches so the
-- page can show them in their own tab; never emailed.
alter table public.matches
  add column near_miss text check (near_miss in ('seniority', 'location', 'pay')),
  add column miss_detail text;

create or replace function public.sync_matches(p_profile uuid, p_rows jsonb) returns void
language sql security definer set search_path = '' as $$
  delete from public.matches m
   where m.profile_id = p_profile
     and not exists (select 1 from jsonb_array_elements(p_rows) r where r->>'posting_id' = m.posting_id);
  insert into public.matches (profile_id, posting_id, where_label, flags, near_miss, miss_detail)
  select p_profile, r->>'posting_id', r->>'where_label',
         coalesce(array(select jsonb_array_elements_text(r->'flags')), '{}'),
         r->>'near_miss', r->>'miss_detail'
    from jsonb_array_elements(p_rows) r
  on conflict (profile_id, posting_id) do update
     set where_label = excluded.where_label, flags = excluded.flags,
         near_miss = excluded.near_miss, miss_detail = excluded.miss_detail
   where (matches.where_label, matches.flags, matches.near_miss, matches.miss_detail)
         is distinct from (excluded.where_label, excluded.flags, excluded.near_miss, excluded.miss_detail);
$$;
revoke execute on function public.sync_matches(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_matches(uuid, jsonb) to service_role;

-- ───────────── Deleting things ─────────────

-- Boards nobody watches any more (and their postings) go, so the database only ever holds boards
-- someone currently follows. Called by the checker each run and when an account is deleted.
create function public.prune_unwatched_boards() returns void
language sql security definer set search_path = '' as $$
  delete from public.companies c where not exists (select 1 from public.watches w where w.company_id = c.id);
$$;
revoke execute on function public.prune_unwatched_boards() from public, anon, authenticated;
grant execute on function public.prune_unwatched_boards() to service_role;

-- Delete my account: the sign-in, profile, companies, matches, Interested / Not for me, alert history.
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then raise exception 'Sign in first'; end if;
  delete from auth.users where id = me; -- everything else is removed with it (on delete cascade)
  perform public.prune_unwatched_boards();
end $$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
