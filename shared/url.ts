/**
 * A link that's safe to make clickable: an ordinary web address. Links arrive from job boards, VC
 * boards, emails and things people type; one that isn't http(s) ("javascript:", "data:") could run
 * code in the page when clicked, so those are treated as no link at all.
 */
export function safeHttpUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}
