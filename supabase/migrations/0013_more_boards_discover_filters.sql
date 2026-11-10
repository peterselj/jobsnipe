-- SmartRecruiters and Recruitee boards, and Discover filters by industry and company stage.
-- Run once in Supabase → SQL Editor, BEFORE merging the PR that needs it. Safe with the code already
-- live: it only widens what's allowed and adds columns.

-- ───────────── Two more kinds of job board ─────────────
-- A SmartRecruiters board is the company's name from its job links; a Recruitee board is the first
-- part of its Recruitee address, which the checker fetches from, so only a plain name is allowed.
alter table public.companies drop constraint if exists companies_ats_check;
alter table public.companies add constraint companies_ats_check
  check (ats in ('greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters', 'recruitee'));

alter table public.companies drop constraint if exists companies_smartrecruiters_board_check;
alter table public.companies add constraint companies_smartrecruiters_board_check
  check (ats <> 'smartrecruiters' or board ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$');

alter table public.companies drop constraint if exists companies_recruitee_board_check;
alter table public.companies add constraint companies_recruitee_board_check
  check (ats <> 'recruitee' or board ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$');

-- ───────────── What VC boards know about each company ─────────────
-- Its funding stage ("series_b", "ipo"...) and industries, so Discover can skip the ones you name in
-- Settings (say, biotech, or pre-seed companies). Jobs from your alert emails have neither.
alter table public.discover_postings
  add column if not exists stage text,
  add column if not exists industries text[] not null default '{}';

create or replace function public.save_discover_postings(p_rows jsonb, p_at timestamptz) returns void
language sql security definer set search_path = '' as $$
  insert into public.discover_postings
    (id, company, title, locations, workplace, url, posted_at, comp_min, comp_max, comp_currency, ats, board, via, for_profile,
     stage, industries, first_seen_at, last_seen_at)
  select r->>'id', r->>'company', r->>'title',
         coalesce(array(select jsonb_array_elements_text(r->'locations')), '{}'),
         r->>'workplace', r->>'url', (r->>'posted_at')::timestamptz,
         (r->>'comp_min')::int, (r->>'comp_max')::int, r->>'comp_currency', r->>'ats', r->>'board',
         coalesce(array(select jsonb_array_elements_text(r->'via')), '{}'),
         (r->>'for_profile')::uuid,
         r->>'stage',
         coalesce(array(select jsonb_array_elements_text(case when jsonb_typeof(r->'industries') = 'array' then r->'industries' else '[]'::jsonb end)), '{}'),
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
         stage = coalesce(excluded.stage, discover_postings.stage),
         industries = case when cardinality(excluded.industries) > 0 then excluded.industries else discover_postings.industries end,
         via = array(select distinct v from unnest(discover_postings.via || excluded.via) v order by v);
$$;
