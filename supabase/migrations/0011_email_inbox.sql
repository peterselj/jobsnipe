-- Job-alert inbox: each person can get an address (e.g. 7f3k9q2m@alerts.joshpetersel.com) to point
-- LinkedIn, Indeed, Wellfound or VC-board job alerts at. Run once in Supabase → SQL Editor, BEFORE
-- merging the PR that needs it. Safe with the code already live: it only adds tables, columns and
-- functions. To undo: drop table public.inbound_emails; and drop the columns and functions below.

-- The address's first part. Null = inbox off (mail to an old address is dropped).
alter table public.profiles add column inbox_token text unique;

-- Turn your inbox on (a fresh address) or off. Returns the new token, or null when turned off.
create function public.set_inbox(p_on boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  token text := case when p_on then substr(md5(gen_random_uuid()::text), 1, 10) end;
begin
  if me is null then raise exception 'Sign in first'; end if;
  update public.profiles set inbox_token = token where id = me;
  return token;
end $$;
revoke execute on function public.set_inbox(boolean) from public, anon;
grant execute on function public.set_inbox(boolean) to authenticated;

-- Emails received, as Brevo hands them over (filed by the small "inbound-email" function). The checker
-- reads new ones hourly and records how many jobs it found. People see their own, so they can tell
-- whether their alerts are arriving and being read (and read a confirmation code, e.g. from Gmail).
create table public.inbound_emails (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  from_name text,
  from_address text,
  subject text,
  html text,
  text_body text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  jobs_found int
);
create index inbound_emails_unprocessed_idx on public.inbound_emails (received_at) where processed_at is null;
alter table public.inbound_emails enable row level security;
create policy "read own emails" on public.inbound_emails for select to authenticated using (profile_id = (select auth.uid()));

-- Called by the inbound-email function: file an email under whoever's address it was sent to. A few
-- limits keep a flood (it's an address anyone can write to) from piling up.
create function public.receive_inbound_email(p_token text, p_from_name text, p_from_address text, p_subject text, p_html text, p_text text)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  who uuid;
begin
  select id into who from public.profiles where inbox_token = lower(p_token);
  if who is null then return false; end if;
  if (select count(*) from public.inbound_emails where profile_id = who and received_at > now() - interval '1 day') >= 200 then
    return false;
  end if;
  insert into public.inbound_emails (profile_id, from_name, from_address, subject, html, text_body)
  values (who, left(p_from_name, 200), left(p_from_address, 320), left(p_subject, 500), left(p_html, 500000), left(p_text, 200000));
  return true;
end $$;
revoke execute on function public.receive_inbound_email(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.receive_inbound_email(text, text, text, text, text, text) to service_role;

-- Jobs found in someone's emails are theirs alone: for_profile says whose (null = found on a VC board,
-- for everyone). on_list marks a match at a company on the person's list that JobSnipe can't check
-- directly; those go to the Inbox (with an instant email) instead of Discover.
alter table public.discover_postings add column for_profile uuid references public.profiles (id) on delete cascade;
alter table public.discover_matches add column on_list boolean not null default false;

create or replace function public.save_discover_postings(p_rows jsonb, p_at timestamptz) returns void
language sql security definer set search_path = '' as $$
  insert into public.discover_postings
    (id, company, title, locations, workplace, url, posted_at, comp_min, comp_max, comp_currency, ats, board, via, for_profile, first_seen_at, last_seen_at)
  select r->>'id', r->>'company', r->>'title',
         coalesce(array(select jsonb_array_elements_text(r->'locations')), '{}'),
         r->>'workplace', r->>'url', (r->>'posted_at')::timestamptz,
         (r->>'comp_min')::int, (r->>'comp_max')::int, r->>'comp_currency', r->>'ats', r->>'board',
         coalesce(array(select jsonb_array_elements_text(r->'via')), '{}'),
         (r->>'for_profile')::uuid,
         p_at, p_at
    from jsonb_array_elements(p_rows) r
  on conflict (id) do update
     set last_seen_at = p_at,
         title = excluded.title,
         locations = excluded.locations,
         workplace = excluded.workplace,
         comp_min = coalesce(excluded.comp_min, discover_postings.comp_min),
         comp_max = coalesce(excluded.comp_max, discover_postings.comp_max),
         comp_currency = coalesce(excluded.comp_currency, discover_postings.comp_currency),
         via = array(select distinct v from unnest(discover_postings.via || excluded.via) v order by v);
$$;

create or replace function public.sync_discover_matches(p_profile uuid, p_rows jsonb) returns void
language sql security definer set search_path = '' as $$
  delete from public.discover_matches m
   where m.profile_id = p_profile
     and not exists (select 1 from jsonb_array_elements(p_rows) r where r->>'posting_id' = m.posting_id);
  insert into public.discover_matches (profile_id, posting_id, where_label, flags, on_list)
  select p_profile, r->>'posting_id', r->>'where_label', coalesce(array(select jsonb_array_elements_text(r->'flags')), '{}'),
         coalesce((r->>'on_list')::boolean, false)
    from jsonb_array_elements(p_rows) r
  on conflict (profile_id, posting_id) do update
     set where_label = excluded.where_label, flags = excluded.flags, on_list = excluded.on_list
   where (discover_matches.where_label, discover_matches.flags, discover_matches.on_list)
         is distinct from (excluded.where_label, excluded.flags, excluded.on_list);
$$;
