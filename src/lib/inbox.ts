/**
 * Job-alert inbox addresses are <token>@INBOX_DOMAIN. Mail for this subdomain is received by Brevo
 * and handed to the "inbound-email" Supabase function (docs/SETUP.md, "Job-alert inbox").
 */
export const INBOX_DOMAIN = 'alerts.joshpetersel.com';
