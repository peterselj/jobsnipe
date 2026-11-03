-- Discover: roles that pass all your filters at companies you don't watch, found on VC portfolio
-- job boards. Run once in Supabase → SQL Editor, BEFORE merging the PR that needs it. Safe with the
-- code already live: it only adds tables, columns and functions.

-- ───────────── Where Discover looks ─────────────

-- Public VC portfolio job boards. Not personal: everyone signed in may see which boards are read.
create table public.discover_sources (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('getro')),
  host text not null unique,       -- e.g. jobs.generalcatalyst.com
  name text not null,              -- shown as "via General Catalyst"
  collection_id text,              -- the board's id on its platform, looked up on first read
  enabled boolean not null default true,
  last_checked_at timestamptz,
  last_ok_at timestamptz,
  last_error text,
  open_postings int
);

insert into public.discover_sources (kind, host, name) values
  ('getro', 'jobs.generalcatalyst.com', 'General Catalyst'),
  ('getro', 'jobs.khoslaventures.com', 'Khosla Ventures'),
  ('getro', 'jobs.accel.com', 'Accel'),
  ('getro', 'jobs.thrivecap.com', 'Thrive Capital'),
  ('getro', 'jobs.luxcapital.com', 'Lux Capital');

-- Jobs found there whose title fits someone. One row per job however many boards list it (keyed by
-- the job's own link); via = which boards list it. A job not seen for two days counts as closed.
create table public.discover_postings (
  id text primary key,
  company text not null,
  title text not null,
  locations text[] not null default '{}',
  workplace text,
  url text not null,
  posted_at timestamptz,
  comp_min int,
  comp_max int,
  comp_currency text,
  -- The company's own board, when the link points at one we can read (for "Watch this company").
  ats text,
  board text,
  via text[] not null default '{}',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index discover_postings_seen_idx on public.discover_postings (last_seen_at);

-- Per person: Discover roles that pass all their filters, rewritten by the checker each time it reads
-- the boards. Never emailed one by one; summed up in the digest.
create table public.discover_matches (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  posting_id text not null references public.discover_postings (id) on delete cascade,
  where_label text,
  flags text[] not null default '{}',
  primary key (profile_id, posting_id)
);

-- How often the Discover digest email comes, and when the last one went.
alter table public.profiles
  add column digest_every text not null default 'daily' check (digest_every in ('daily', 'weekly', 'biweekly', 'never')),
  add column last_digest_at timestamptz;
grant update (digest_every) on public.profiles to authenticated;

-- ───────────── Who sees what ─────────────

alter table public.discover_sources enable row level security;
alter table public.discover_postings enable row level security;
alter table public.discover_matches enable row level security;

create policy "read discover sources" on public.discover_sources for select to authenticated using (true);
create policy "read own discover matches" on public.discover_matches for select to authenticated
  using (profile_id = (select auth.uid()));
-- Only the Discover jobs matched to you (which jobs matched someone else would hint at their search).
create policy "read my discover postings" on public.discover_postings for select to authenticated
  using (exists (select 1 from public.discover_matches m where m.posting_id = discover_postings.id and m.profile_id = (select auth.uid())));

-- ───────────── Written by the checker ─────────────

-- Save what one read of the boards found: new jobs are added, known ones are marked seen and pick up
-- any board that newly lists them.
create function public.save_discover_postings(p_rows jsonb, p_at timestamptz) returns void
language sql security definer set search_path = '' as $$
  insert into public.discover_postings
    (id, company, title, locations, workplace, url, posted_at, comp_min, comp_max, comp_currency, ats, board, via, first_seen_at, last_seen_at)
  select r->>'id', r->>'company', r->>'title',
         coalesce(array(select jsonb_array_elements_text(r->'locations')), '{}'),
         r->>'workplace', r->>'url', (r->>'posted_at')::timestamptz,
         (r->>'comp_min')::int, (r->>'comp_max')::int, r->>'comp_currency', r->>'ats', r->>'board',
         coalesce(array(select jsonb_array_elements_text(r->'via')), '{}'),
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
revoke execute on function public.save_discover_postings(jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.save_discover_postings(jsonb, timestamptz) to service_role;

create function public.sync_discover_matches(p_profile uuid, p_rows jsonb) returns void
language sql security definer set search_path = '' as $$
  delete from public.discover_matches m
   where m.profile_id = p_profile
     and not exists (select 1 from jsonb_array_elements(p_rows) r where r->>'posting_id' = m.posting_id);
  insert into public.discover_matches (profile_id, posting_id, where_label, flags)
  select p_profile, r->>'posting_id', r->>'where_label', coalesce(array(select jsonb_array_elements_text(r->'flags')), '{}')
    from jsonb_array_elements(p_rows) r
  on conflict (profile_id, posting_id) do update
     set where_label = excluded.where_label, flags = excluded.flags
   where (discover_matches.where_label, discover_matches.flags) is distinct from (excluded.where_label, excluded.flags);
$$;
revoke execute on function public.sync_discover_matches(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sync_discover_matches(uuid, jsonb) to service_role;
