// Supabase Edge Function "inbound-email": Brevo's inbound parsing posts each email received at
// <token>@<your alerts subdomain> here, and it's filed under the person whose address that is.
// Deploy from the Supabase dashboard (Edge Functions → Deploy a new function → via Editor), named
// "inbound-email", with "Enforce JWT verification" turned OFF (Brevo can't send a Supabase key; the
// webhook address carries its own key instead, checked in the database).
// The checker reads the filed emails hourly. Setup: docs/SETUP.md, "Job-alert inbox".
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

type Addr = { Name?: string; Address?: string };

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  // Brevo's webhook address carries a key (put there by the setup workflow); nothing else may file mail.
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (key.length < 32) return new Response("not allowed", { status: 403 });
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > 5_000_000) return new Response("too big", { status: 413 });
  let body: { items?: Record<string, unknown>[] };
  try {
    body = await req.json();
  } catch {
    return new Response("not JSON", { status: 400 });
  }
  let filed = 0;
  for (const item of body.items ?? []) {
    const from = (item.From ?? {}) as Addr;
    const to = [...((item.To ?? []) as Addr[]), ...((item.Recipients ?? []) as (Addr | string)[]).map((r) => (typeof r === "string" ? { Address: r } : r))];
    for (const t of to) {
      const token = t.Address?.split("@")[0]?.toLowerCase();
      if (!token) continue;
      const { data, error } = await db.rpc("receive_inbound_email", {
        p_key: key,
        p_token: token,
        p_from_name: from.Name ?? null,
        p_from_address: from.Address ?? null,
        p_subject: String(item.Subject ?? ""),
        p_html: String(item.RawHtmlBody ?? ""),
        p_text: String(item.RawTextBody ?? item.ExtractedMarkdownMessage ?? ""),
      });
      if (error) return new Response("not allowed", { status: 403 });
      if (data) filed++;
    }
  }
  // Always 200 so Brevo doesn't retry mail for addresses that don't exist.
  return Response.json({ filed });
});
