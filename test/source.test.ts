import { describe, expect, it } from 'vitest';
import { allRows, SupabaseSource } from '../src/lib/source';

/**
 * Just enough of the Supabase client for load(): each table answers with its rows, in posting_id
 * order when asked, and never more than 1000 per request, like the real API.
 */
function fakeDb(tables: Record<string, any[]>) {
  const requests: Record<string, number> = {};
  return {
    requests,
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      let from = 0;
      let to = Infinity;
      let single = false;
      const q = {
        select: () => q,
        eq: () => q,
        order: (col: string) => {
          if (col === 'posting_id') rows.sort((a, b) => a.posting_id.localeCompare(b.posting_id));
          return q;
        },
        limit: (n: number) => { to = Math.min(to, from + n - 1); return q; },
        range: (a: number, b: number) => { from = a; to = b; return q; },
        single: () => { single = true; return q; },
        then(resolve: (r: { data: unknown; error: null }) => void) {
          requests[table] = (requests[table] ?? 0) + 1;
          const data = rows.slice(from, Math.min(to + 1, from + 1000));
          resolve({ data: single ? data[0] : data, error: null });
        },
      };
      return q;
    },
  };
}

const id = (i: number) => `greenhouse:acme:${String(i).padStart(5, '0')}`;

describe('SupabaseSource.load', () => {
  it('loads every match and decision past the 1000-row cap, so handled roles stay out of the Inbox', async () => {
    const N = 2500;
    const db = fakeDb({
      profiles: [{ id: 'me', name: 'Me', email: 'me@example.com', criteria: {} }],
      matches: Array.from({ length: N }, (_, i) => ({
        posting_id: id(i), flags: [],
        postings: { id: id(i), company_id: 1, title: `Role ${i}`, url: 'https://x', first_seen_at: '2026-01-01T00:00:00Z' },
      })),
      // Every one of those roles has been archived.
      verdicts: Array.from({ length: N }, (_, i) => ({ posting_id: id(i), archived_at: '2026-02-01T00:00:00Z', created_at: '2026-02-01T00:00:00Z' })),
      discover_matches: Array.from({ length: N }, (_, i) => ({
        posting_id: `d:${id(i)}`, flags: [],
        discover_postings: { id: `d:${id(i)}`, company: 'Globex', title: `Found ${i}`, url: 'https://y', first_seen_at: '2026-01-01T00:00:00Z', via: ['Board A'] },
      })),
    });

    const snap = await new SupabaseSource(db as any, 'me').load();

    expect(Object.keys(snap.feedback)).toHaveLength(N);
    expect(snap.matches).toHaveLength(2 * N);
    // The Inbox rule from Matches.tsx: a match with no decision.
    const inbox = snap.matches.filter((m) => !m.via && !snap.feedback[m.id]);
    expect(inbox).toEqual([]);
    // 2500 rows = pages of 1000, 1000 and 500.
    expect(db.requests).toMatchObject({ matches: 3, verdicts: 3, discover_matches: 3 });
  });

  it('asks once when everything fits in one page, and reports a failed page', async () => {
    const db = fakeDb({ profiles: [{ id: 'me', criteria: {} }] });
    await new SupabaseSource(db as any, 'me').load();
    expect(db.requests).toMatchObject({ matches: 1, verdicts: 1, discover_matches: 1 });

    const res = await allRows(async (from) => (from === 0 ? { data: Array(1000).fill({}), error: null } : { data: null, error: { message: 'boom' } }));
    expect(res).toEqual({ data: null, error: { message: 'boom' } });
  });
});
