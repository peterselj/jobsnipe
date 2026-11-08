-- Workday career sites can be watched too. Run once in Supabase → SQL Editor before merging (safe to
-- run twice).
--
-- A Workday board is stored as "host/tenant/site", e.g.
-- "nvidia.wd5.myworkdayjobs.com/nvidia/NVIDIAExternalCareerSite". The checker fetches from that
-- host, so only real Workday hosts are allowed in.
alter table public.companies drop constraint if exists companies_ats_check;
alter table public.companies add constraint companies_ats_check
  check (ats in ('greenhouse', 'lever', 'ashby', 'workday'));

alter table public.companies drop constraint if exists companies_workday_board_check;
alter table public.companies add constraint companies_workday_board_check
  check (
    ats <> 'workday'
    or board ~ '^[a-z0-9-]+(\.wd[0-9]{1,3})?\.myworkdayjobs\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
    or board ~ '^wd[0-9]{1,3}\.myworkdaysite\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'
  );
