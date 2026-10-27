// Formatting shared by the page and the alert emails, so both say the same thing.

export function money(c: { min: number; max: number; currency: string }): string {
  const k = (n: number) => `${Math.round(n / 1000)}K`;
  const sym = c.currency === 'CAD' ? 'CA$' : c.currency === 'USD' ? '$' : `${c.currency} `;
  return `${sym}${k(c.min)}–${sym}${k(c.max)}`;
}

/** "just now", "12m ago", "3h ago", "5d ago". */
export function ago(iso: string | undefined, now: number | Date = Date.now()): string {
  if (!iso) return '—';
  const min = Math.max(0, Math.round((+now - Date.parse(iso)) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
