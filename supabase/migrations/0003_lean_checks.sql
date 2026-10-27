-- Leaner hourly checks. Run once in Supabase → SQL Editor, BEFORE merging the PR that needs it.
-- Safe with the code already live: it only adds columns and a function.

-- Postings are marked closed when they leave a board, instead of every open posting being
-- rewritten every hour to say "still here". Open = closed_at is null.
alter table public.postings add column closed_at timestamptz;
create index postings_open_idx on public.postings (company_id) where closed_at is null;
update public.postings p
   set closed_at = p.last_seen_at
  from public.companies c
 where c.id = p.company_id and c.last_ok_at is not null and p.last_seen_at < c.last_ok_at;

-- Whether we've looked for this posting's pay yet. Greenhouse lists leave pay out, so it's fetched
-- once per posting, only when the title fits someone. Existing rows were fetched with full details.
alter table public.postings add column comp_checked boolean not null default false;
update public.postings set comp_checked = true;

-- Each board's version tag (ETag) from its last successful check. Boards answer "unchanged" with
-- no data when it matches, so a quiet hour downloads almost nothing.
alter table public.companies add column etag text;

-- Make one person's matches exactly p_rows in a single transaction: no moment where the inbox is
-- empty, and unchanged rows aren't rewritten.
create function public.sync_matches(p_profile uuid, p_rows jsonb) returns void
language sql security definer set search_path = '' as $$
  delete from public.matches m
   where m.profile_id = p_profile
     and not exists (select 1 from jsonb_array_elements(p_rows) r where r->>'posting_id' = m.posting_id);
  insert into public.matches (profile_id, posting_id, where_label, flags)
  select p_profile, r->>'posting_id', r->>'where_label',
         coalesce(array(select jsonb_array_elements_text(r->'flags')), '{}')
    from jsonb_array_elements(p_rows) r
  on conflict (profile_id, posting_id) do update
     set where_label = excluded.where_label, flags = excluded.flags
   where matches.where_label is distinct from excluded.where_label
      or matches.flags is distinct from excluded.flags;
$$;
revoke execute on function public.sync_matches(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_matches(uuid, jsonb) to service_role;
