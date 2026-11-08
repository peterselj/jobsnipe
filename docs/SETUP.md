# Setting up JobSnipe

One-time setup for the owner. People who just use JobSnipe only need their email address.

How it fits together: the page (GitHub Pages) signs people in and reads/writes their data in
**Supabase**. Every hour Supabase starts the **checker** (a GitHub Action in this repo), which reads
the job boards, saves postings and matches to Supabase, and emails new matches through **Brevo**.

Keys and where they live:

| Key | Lives in | Who sees it |
|---|---|---|
| Supabase publishable key | `src/lib/supabase.ts` | Public by design; row-level security limits it to each person's own data |
| Supabase secret key | GitHub secret `SUPABASE_SECRET_KEY` | Only the checker |
| Brevo API key | GitHub secret `BREVO_API_KEY` | Only the checker (alert emails) |
| Brevo SMTP key | Supabase → Authentication → SMTP | Only Supabase (sign-in emails) |
| GitHub token (Actions only) | Supabase Vault `github_dispatch_token` | Only the hourly timer and Check now |

Never paste the secret ones into chat, code, or an issue.

## 1. Brevo (email)

1. **Authenticate your domain:** Senders, Domains & Dedicated IPs → **Domains** → Add a domain →
   `joshpetersel.com`. Brevo lists DNS records (a `brevo-code` TXT, DKIM, and DMARC). Add them where
   the domain's DNS is managed, then click **Verify** (DNS can take up to a few hours).
2. **Add the sender:** Senders → Add a sender → name `JobSnipe`, email `postalservice@joshpetersel.com`.
3. **API key** (for alert emails): SMTP & API → **API Keys** → Generate. Copy it for step 3.
4. **SMTP key** (for sign-in emails): SMTP & API → **SMTP** tab. Note the **Login** shown there
   (looks like `abc123@smtp-brevo.com`) and generate an **SMTP key**. Copy both for step 2.

New Brevo accounts are sometimes reviewed before they can send; if sends fail with an "account
under validation" message, that review is why.

## 2. Supabase

1. **Create the database:** SQL Editor → New query → paste all of
   [`supabase/migrations/0001_init.sql`](../supabase/migrations/0001_init.sql) → **Run**. If it stops
   on `pg_cron` or `pg_net`, enable both under Database → Extensions and run it again. Then run each
   later file in `supabase/migrations/` the same way, in number order (each in a fresh New query).
   When a pull request adds a migration, its description says to run it, and when: before or after merging.
2. **Sign-in links:** Authentication → **URL Configuration**:
   - Site URL: `https://peterselj.github.io/jobsnipe/`
   - Redirect URLs: add `https://peterselj.github.io/jobsnipe/**` and `http://localhost:5173/jobsnipe/**`
3. **Send sign-in emails through Brevo:** Authentication → Emails → **SMTP Settings** → enable custom SMTP:
   - Sender email `postalservice@joshpetersel.com`, sender name `JobSnipe`
   - Host `smtp-relay.brevo.com`, port `587`
   - Username: the Brevo SMTP **Login**; password: the Brevo **SMTP key**
4. **Keys:** Project Settings → **API Keys**. The `sb_publishable_…` key goes in
   `src/lib/supabase.ts` (fine to share). The `sb_secret_…` key goes in GitHub (step 3); keep it secret.

## 3. GitHub (this repo)

1. Settings → Secrets and variables → Actions → **Secrets** tab:
   - `SUPABASE_SECRET_KEY` = the `sb_secret_…` key
   - `BREVO_API_KEY` = the Brevo API key
2. Same page, **Variables** tab: `MAIL_FROM` = `postalservice@joshpetersel.com`
3. **Token for the hourly timer:** GitHub → Settings → Developer settings → Fine-grained tokens →
   Generate: name `JobSnipe timer`, expiration 1 year, repository access **Only select repositories →
   jobsnipe**, permissions → Repository → **Actions: Read and write**. Copy it, then in Supabase's
   SQL Editor run (with your token in place of the placeholder):

   ```sql
   select vault.create_secret('github_pat_PASTE_HERE', 'github_dispatch_token');
   ```

   To replace it later (e.g. when it expires):
   `select vault.update_secret((select id from vault.secrets where name = 'github_dispatch_token'), 'NEW_TOKEN');`

## 4. First run

1. Open https://peterselj.github.io/jobsnipe/, enter your email, and click the link that arrives.
2. Set filters in **Settings** and add companies, or (Josh) run `migrate/josh-seed.sql` from the private
   `JobSnipe-backend` repo in the SQL Editor to copy the existing profile and companies over.
3. Click **Check now**. Within a minute or two you should see matches and get a "JobSnipe is
   watching" email. The run also appears under this repo's Actions tab.

## 5. Job-alert inbox (optional)

Gives each person an address like `7f3k9q2m0a@alerts.joshpetersel.com` to point job alerts at
(LinkedIn, Indeed, Wellfound, VC boards such as Sequoia's and a16z's). Mail for the subdomain goes to
Brevo, which hands each email to a small Supabase function; the checker reads them hourly. Your main
`joshpetersel.com` mail is untouched: only the `alerts.` subdomain changes.

1. **Database:** run `supabase/migrations/0011_email_inbox.sql` (SQL Editor, as in step 2).
2. **DNS:** where the domain's DNS is managed, add **MX** records for the host `alerts` pointing at
   Brevo's inbound servers. Brevo's help article "Inbound parsing" lists them (at the time of writing
   `inbound1.brevo.com` and `inbound2.brevo.com`, priority 10; use whatever Brevo lists now).
3. **Supabase function:** Edge Functions → **Deploy a new function** → **Via Editor** → name it
   `inbound-email` → replace the sample code with all of
   [`supabase/functions/inbound-email/index.ts`](../supabase/functions/inbound-email/index.ts) →
   Deploy. Then open the function's **Details** and turn **Enforce JWT verification** off (Brevo
   can't send a Supabase key; the function only files mail for addresses that exist).
4. **Brevo:** GitHub → Actions → **Set up job-alert inbox** → Run workflow (the subdomain is filled
   in). If it fails saying the key isn't allowed, make a new Brevo API key with webhook access,
   replace the `BREVO_API_KEY` secret, and run it again.
5. **Try it:** JobSnipe → Settings → Job-alert inbox → **Get my alerts address**, then send any email
   to it. It should appear under "Recent emails" within a minute or two (marked "not read yet" until
   the next hourly check).

To switch it off for everyone: delete the webhook in Brevo (or the function in Supabase). Each person
can also turn their own address off in Settings.

## Checking on it

- **Runs:** this repo → Actions → "Check job boards". Each run's log lists every board and any errors.
- **Timer:** in Supabase SQL Editor, `select * from cron.job_run_details order by start_time desc limit 5;`
  shows the last hourly starts; `select * from net._http_response order by created desc limit 5;` shows
  GitHub's replies (204 = started).
