-- Security hardening. Run once in Supabase → SQL Editor, BEFORE merging the PR that needs it. Safe
-- with the code already live, with one visible change: until the new page is live, editing "Send
-- alerts to" in Settings fails with "permission denied" (the new page changes it the verified way).

-- ───────────── 1. "Check now" ─────────────
-- The reason used to come from the page as free text and travel on to the GitHub workflow. Now only
-- two fixed reasons exist, whatever is sent, and one person can't start more than 20 checks an hour.

create or replace function public.dispatch_check(p_reason text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  token text;
  reason text := case when p_reason = 'schedule' then 'schedule' else 'check now' end;
begin
  select decrypted_secret into token from vault.decrypted_secrets where name = 'github_dispatch_token';
  if token is null then
    raise exception 'No github_dispatch_token in Vault; see docs/SETUP.md';
  end if;
  return net.http_post(
    url := 'https://api.github.com/repos/peterselj/jobsnipe/actions/workflows/check.yml/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('reason', reason)),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || token,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'jobsnipe',
      'Content-Type', 'application/json'
    )
  );
end $$;
revoke execute on function public.dispatch_check(text) from public, anon, authenticated;

create or replace function public.request_check(p_reason text default 'check now') returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  last_at timestamptz;
begin
  if me is null then
    raise exception 'Sign in first';
  end if;
  select max(requested_at) into last_at from public.check_requests;
  if last_at is not null and last_at > now() - interval '60 seconds' then
    return last_at;
  end if;
  if (select count(*) from public.check_requests where requested_by = me and requested_at > now() - interval '1 hour') >= 20 then
    raise exception 'That''s a lot of checks. The hourly check will pick things up; try again in a bit.';
  end if;
  insert into public.check_requests (requested_by, reason) values (me, 'check now');
  perform public.dispatch_check('check now');
  return now();
end $$;
revoke execute on function public.request_check(text) from public, anon;
grant execute on function public.request_check(text) to authenticated;

-- ───────────── 2. Alerts only go to an address its owner confirmed ─────────────
-- Anyone could set "Send alerts to" to any address, and JobSnipe would have emailed it. Now the alert
-- address follows the sign-in address, which Supabase only changes after a confirmation link is
-- clicked. (An alert address that already differs from the sign-in one is left as it is.)

revoke update (email) on public.profiles from authenticated;

create function public.sync_profile_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email and new.email is not null then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end $$;

create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function public.sync_profile_email();

-- ───────────── 3. Limits, so one account can't run up the bill ─────────────
-- Every watched board is fetched hourly and every job title is searched on every VC board, so both
-- are capped per person. The caps are far above normal use.

create or replace function public.add_watch(p_name text, p_ats text default null, p_board text default null,
                                            p_careers_url text default null, p_note text default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  cid bigint;
  wid bigint;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the company a name'; end if;
  if length(p_name) > 120 or length(coalesce(p_board, '')) > 200 or length(coalesce(p_note, '')) > 300 then
    raise exception 'That''s too long';
  end if;
  if nullif(trim(p_careers_url), '') is not null and (length(p_careers_url) > 500 or trim(p_careers_url) !~* '^https?://') then
    raise exception 'The careers link should start with https://';
  end if;
  if (select count(*) from public.watches where profile_id = me) >= 150 then
    raise exception 'You''re watching 150 companies, which is the limit. Remove one to add another.';
  end if;
  if p_ats is not null and p_ats <> 'none' then
    cid := public.company_id_for(p_ats, p_board, trim(p_name));
    if exists (select 1 from public.watches where profile_id = me and company_id = cid) then
      raise exception 'Already watching that board';
    end if;
  end if;
  insert into public.watches (profile_id, company_id, name, careers_url, note)
    values (me, cid, trim(p_name), nullif(trim(p_careers_url), ''), nullif(trim(p_note), ''))
    returning id into wid;
  return wid;
end $$;

create or replace function public.change_watch_board(p_watch_id bigint, p_ats text, p_board text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  w public.watches;
  cid bigint;
begin
  if length(coalesce(p_board, '')) > 200 then raise exception 'That''s too long'; end if;
  select * into w from public.watches where id = p_watch_id and profile_id = me;
  if w.id is null then raise exception 'That company is no longer in your list'; end if;
  cid := public.company_id_for(p_ats, p_board, w.name);
  if exists (select 1 from public.watches where profile_id = me and company_id = cid and id <> w.id) then
    raise exception 'Already watching that board';
  end if;
  -- A new board means a fresh "now watching" summary rather than an email per existing posting.
  update public.watches set company_id = cid, baselined_at = null, note = null where id = w.id;
end $$;

-- "not valid" = enforced for everything saved from now on, without re-checking what's already stored.
alter table public.profiles
  add constraint profiles_criteria_size check (octet_length(criteria::text) <= 20000) not valid,
  add constraint profiles_name_size check (length(name) <= 120) not valid;
alter table public.watches
  add constraint watches_filters_size check (filters is null or octet_length(filters::text) <= 5000) not valid;
alter table public.verdicts
  add constraint verdicts_text_size check (
    length(coalesce(reason, '')) <= 1000 and length(coalesce(company, '')) <= 300
    and length(coalesce(title, '')) <= 300 and length(posting_id) <= 300
  ) not valid;

-- Interested / Not for me / Archive rows are the one table people write freely; cap it per person.
create function public.cap_verdicts() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.verdicts where profile_id = new.profile_id) >= 20000 then
    raise exception 'That''s the limit of saved roles. Empty some of your Archive first.';
  end if;
  return new;
end $$;
create trigger verdicts_cap before insert on public.verdicts
  for each row execute function public.cap_verdicts();

-- ───────────── 4. Job links must be web links ─────────────
-- Links come from job boards, VC boards and emails, and the page turns them into clickable links. A
-- link that isn't http(s) (a "javascript:" one, say) could run code in the page when clicked. The
-- checker and the page each refuse those too; this is the last line of defence.

-- Tidy what's stored first, so nothing already saved trips the new rules later.
update public.watches set careers_url = 'https://' || careers_url
 where careers_url is not null and careers_url !~* '^https?://' and careers_url !~ '^[a-zA-Z][a-zA-Z0-9+.-]*:';
update public.watches set careers_url = null where careers_url is not null and careers_url !~* '^https?://';
update public.verdicts set url = null where url is not null and url <> '' and url !~* '^https?://';

alter table public.postings add constraint postings_url_web check (url ~* '^https?://') not valid;
alter table public.discover_postings add constraint discover_postings_url_web check (url ~* '^https?://') not valid;
alter table public.verdicts add constraint verdicts_url_web check (url is null or url = '' or url ~* '^https?://') not valid;
alter table public.watches add constraint watches_careers_url_web check (careers_url is null or careers_url ~* '^https?://') not valid;
