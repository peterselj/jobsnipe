import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ago, money } from "../../shared/format.js";
import type { FilterResult, Posting } from "./types.js";

export const SITE = "https://peterselj.github.io/jobsnipe/";

export interface Email {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface Mailer {
  send(e: Email): Promise<void>;
  describe: string;
}

/**
 * Brevo's transactional email API when BREVO_API_KEY and MAIL_FROM are set; otherwise (or with
 * dryRun) emails are written to out/ so a run can be inspected without sending anything.
 */
export function makeMailer(env: Record<string, string | undefined> = process.env, opts: { dryRun?: boolean; outDir?: string } = {}): Mailer {
  // GitHub Actions passes an unset secret as "", so treat empty the same as missing.
  const key = env.BREVO_API_KEY || undefined;
  const from = env.MAIL_FROM || undefined;
  if (!opts.dryRun && key && from) {
    return {
      describe: `Brevo as ${from}`,
      async send(e) {
        const res = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            sender: { name: "JobSnipe", email: from },
            to: [{ email: e.to }],
            subject: e.subject,
            htmlContent: e.html,
            textContent: e.text,
          }),
          signal: AbortSignal.timeout(20_000),
        });
        if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 300)}`);
      },
    };
  }
  if (!opts.dryRun && (key || from)) throw new Error("Set both BREVO_API_KEY and MAIL_FROM to send email");
  const outDir = opts.outDir ?? "out";
  let n = 0;
  return {
    describe: `dry run, writing emails to ${outDir}/`,
    async send(e) {
      mkdirSync(outDir, { recursive: true });
      const base = join(outDir, `${Date.now()}-${n++}`);
      writeFileSync(`${base}.html`, `<!-- To: ${e.to} | ${e.subject} -->\n${e.html}`);
      writeFileSync(`${base}.txt`, `To: ${e.to}\nSubject: ${e.subject}\n\n${e.text}`);
    },
  };
}

// JobBoard's forest/paper palette, inlined because email clients ignore stylesheets.
const C = { ink: "#1b211d", muted: "#6f776d", paper: "#f3f3ee", card: "#fbfbf8", line: "#e6e6df", forest: "#2f5e4a", gold: "#9a6b1f", brick: "#9c3b32" };
const FONT = `"Hanken Grotesk", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif`;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** "posted 3h ago", in the same wording as the page. */
const posted = (iso: string | undefined, now: Date) => (iso ? `posted ${ago(iso, now)}` : "posting time unknown");

function postingFacts(p: Posting, r: FilterResult, now: Date): string[] {
  return [r.where ?? p.locations.join("; "), p.comp ? money(p.comp) : "", posted(p.atsPostedAt, now)].filter(Boolean);
}

function card(p: Posting, r: FilterResult, now: Date): string {
  const flags = r.flags.length
    ? `<div style="margin-top:6px;font-size:13px;color:${C.gold}">⚑ ${r.flags.map(esc).join(" · ")}</div>`
    : "";
  return `<div style="background:${C.card};border:1px solid ${C.line};border-radius:10px;padding:14px 16px;margin:0 0 10px">
  <div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${C.muted}">${esc(p.company)}</div>
  <a href="${esc(p.url)}" style="display:block;margin:2px 0 4px;font-size:17px;font-weight:700;color:${C.forest};text-decoration:none">${esc(p.title)}</a>
  <div style="font-size:14px;color:${C.ink}">${postingFacts(p, r, now).map(esc).join(" · ")}</div>${flags}
</div>`;
}

function layout(heading: string, body: string): string {
  return `<!doctype html><html><body style="margin:0;background:${C.paper};font-family:${FONT};color:${C.ink}">
<div style="max-width:600px;margin:0 auto;padding:24px 16px">
  <div style="font-size:13px;font-weight:700;color:${C.forest};letter-spacing:.04em">◎ JOBSNIPE</div>
  <h1 style="font-size:20px;margin:6px 0 16px">${esc(heading)}</h1>
  ${body}
  <p style="margin:24px 0 0;font-size:12px;color:${C.muted}">
    <a href="${SITE}" style="color:${C.forest}">Open JobSnipe</a> to mark roles Interested or Not for me, or change your filters and companies.
  </p>
</div></body></html>`;
}

const textLine = (p: Posting, r: FilterResult, now: Date) =>
  `${p.company} — ${p.title}\n  ${postingFacts(p, r, now).join(" · ")}${r.flags.length ? `\n  flags: ${r.flags.join("; ")}` : ""}\n  ${p.url}`;

export function matchEmail(to: string, p: Posting, r: FilterResult, now: Date): Email {
  const where = r.where ? ` (${r.where})` : "";
  return {
    to,
    subject: `New match: ${p.title} at ${p.company}${where}`,
    html: layout("New match", card(p, r, now)),
    text: textLine(p, r, now),
  };
}

export interface BaselineCompany {
  name: string;
  ok: boolean;
  detail: string;
}

/** Sent once when companies are first added: what's open right now, and what we can't watch. */
export function baselineEmail(
  to: string,
  matches: { p: Posting; r: FilterResult }[],
  companies: BaselineCompany[],
  now: Date,
): Email {
  const list = matches.length
    ? matches.map(({ p, r }) => card(p, r, now)).join("")
    : `<p style="color:${C.muted}">No currently open roles pass your filters.</p>`;
  const rows = companies
    .map(
      (c) => `<tr><td style="padding:3px 12px 3px 0">${c.ok ? "✓" : `<span style="color:${C.brick}">✕</span>`} ${esc(c.name)}</td><td style="padding:3px 0;color:${C.muted}">${esc(c.detail)}</td></tr>`,
    )
    .join("");
  const html = layout(
    `Now watching ${companies.filter((c) => c.ok).length} companies`,
    `<p style="font-size:14px;margin:0 0 14px">From now on you'll get one email per new posting that passes your filters. These ${matches.length} matching roles were already open:</p>
${list}
<h2 style="font-size:15px;margin:22px 0 8px">Companies</h2>
<table style="font-size:14px;border-collapse:collapse">${rows}</table>`,
  );
  const text = [
    `Now watching. These ${matches.length} matching roles were already open:`,
    ...matches.map(({ p, r }) => textLine(p, r, now)),
    "",
    "Companies:",
    ...companies.map((c) => `${c.ok ? "✓" : "✕"} ${c.name}: ${c.detail}`),
  ].join("\n");
  return { to, subject: `JobSnipe is watching: ${matches.length} open matches`, html, text };
}

export function healthEmail(to: string, failing: { name: string; error: string; since?: string }[]): Email {
  const items = failing
    .map((f) => `<li style="margin:0 0 6px"><b>${esc(f.name)}</b>: ${esc(f.error)}${f.since ? ` <span style="color:${C.muted}">(last OK ${esc(f.since)})</span>` : ""}</li>`)
    .join("");
  return {
    to,
    subject: `JobSnipe: ${failing.length} compan${failing.length === 1 ? "y" : "ies"} can't be checked`,
    html: layout(
      "Some job boards are failing",
      `<p style="font-size:14px">New postings at these companies won't reach you until this is fixed. Usually the company moved job boards; find a current posting URL and update the board.</p><ul style="font-size:14px;padding-left:18px">${items}</ul>`,
    ),
    text: failing.map((f) => `${f.name}: ${f.error}`).join("\n"),
  };
}
