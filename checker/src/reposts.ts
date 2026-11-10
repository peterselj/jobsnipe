import type { HandledRow } from "./store.js";

// Companies often take a job down and put it back up as a "new" posting with a new id. If you already
// decided on that role (Interested, Not for me, or archived), the copy isn't news: it's flagged, and
// nothing is emailed about it.

export const REPOST_FLAG = "looks like a repost of a role you already handled";

/** "Acme AI, Inc." and "acme" are the same company for "is it already on my list?" and for reposts. */
export function companyKey(name: string): string {
  const words = name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const drop = new Set(["inc", "llc", "ltd", "corp", "co", "the", "ai", "labs", "hq", "technologies", "technology"]);
  const kept = words.filter((w) => !drop.has(w));
  return (kept.length ? kept : words).join("");
}

const roleKey = (company: string, title: string) => `${companyKey(company)}|${title.toLowerCase().replace(/\s+/g, " ").trim()}`;

/** For each person, the roles they've handled, to spot the same role coming back under a new id. */
export class Handled {
  private byPerson = new Map<string, Map<string, Set<string>>>();

  constructor(rows: HandledRow[]) {
    for (const r of rows) {
      if (!r.company || !r.title) continue;
      const mine = this.byPerson.get(r.profile_id) ?? new Map<string, Set<string>>();
      this.byPerson.set(r.profile_id, mine);
      const key = roleKey(r.company, r.title);
      mine.set(key, (mine.get(key) ?? new Set()).add(r.posting_id));
    }
  }

  /** True when this person handled the same role at the same company under a different id. */
  isRepost(profileId: string, posting: { id: string; company: string; title: string }): boolean {
    const ids = this.byPerson.get(profileId)?.get(roleKey(posting.company, posting.title));
    return !!ids && [...ids].some((id) => id !== posting.id);
  }
}
