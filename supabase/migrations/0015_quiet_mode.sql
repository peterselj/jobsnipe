-- A quieter JobSnipe for people who just want a ping when one specific role opens up.
-- Run once in Supabase → SQL Editor, BEFORE merging the PR that needs it. Safe with the code
-- already live: it only adds columns.
--
-- New accounts start with the Near misses tab and Discover turned off (both can be turned on in
-- Settings). Accounts that exist today keep both on, exactly as they are now.
-- To undo: alter table public.profiles drop column near_misses_on, drop column discover_on,
--          drop column monthly_note, drop column quiet_since;

alter table public.profiles
  add column near_misses_on boolean not null default false,
  add column discover_on boolean not null default false,
  -- A short "still watching, nothing new" email after 30 days with no email from JobSnipe.
  add column monthly_note boolean not null default true,
  -- When JobSnipe last emailed this person (or when they joined); the checker keeps it up to date.
  add column quiet_since timestamptz not null default now();

-- Everyone who's already here keeps what they have.
update public.profiles set near_misses_on = true, discover_on = true;

grant update (near_misses_on, discover_on, monthly_note) on public.profiles to authenticated;
