-- Discover: pay looked up on the company's own board. Run once in Supabase → SQL Editor, BEFORE
-- merging the PR that needs it. Safe with the code already live: it only adds a column.
--
-- VC boards often leave pay out even when the company's own board lists it. When a Discover job
-- links to a board JobSnipe reads, its pay is looked up there once; comp_checked records that.
alter table public.discover_postings add column comp_checked boolean not null default false;
