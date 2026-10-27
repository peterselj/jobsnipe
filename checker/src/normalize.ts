/** Text helpers shared by the ATS fetchers. */

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Greenhouse double-escapes its HTML, so decode until stable, then strip tags. */
export function htmlToText(html: string): string {
  let s = html;
  for (let i = 0; i < 3; i++) {
    const next = decodeEntities(s);
    if (next === s) break;
    s = next;
  }
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// One money amount: optional currency prefix, number with commas or a k suffix.
const AMOUNT = String.raw`(CA\$|C\$|US\$|\$|CAD\s?|USD\s?)\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s?([kK])?`;
const RANGE = new RegExp(
  `${AMOUNT}\\s*(?:-|–|—|to)\\s*${AMOUNT}(?:\\s*(USD|CAD))?`,
  "g",
);

function toNumber(digits: string, k?: string): number {
  const n = parseFloat(digits.replace(/,/g, ""));
  return k ? n * 1000 : n;
}

function currencyOf(...hints: (string | undefined)[]): string {
  const h = hints.filter(Boolean).join(" ").toUpperCase();
  return /CA\$|C\$|CAD/.test(h) ? "CAD" : "USD";
}

/**
 * Pull an annual salary range out of free text ("$149,000 - $204,500", "CA$155K – CA$185K").
 * With several ranges (one per city, say) we keep the widest span. Hourly and implausible
 * numbers are ignored, so "$100M ARR" or "$60/hr" never become a salary.
 */
export function parseCompText(text: string): { min: number; max: number; currency: string } | undefined {
  let best: { min: number; max: number; currency: string } | undefined;
  for (const m of text.matchAll(RANGE)) {
    const after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 12).toLowerCase();
    if (/^\s*(\/|per)\s*(hr|hour)/.test(after)) continue;
    const min = toNumber(m[2], m[3]);
    const max = toNumber(m[5], m[6]);
    if (min < 20_000 || max > 2_000_000 || max < min) continue;
    const currency = currencyOf(m[1], m[4], m[7]);
    if (!best) best = { min, max, currency };
    else if (best.currency === currency) {
      best = { min: Math.min(best.min, min), max: Math.max(best.max, max), currency };
    }
  }
  return best;
}
