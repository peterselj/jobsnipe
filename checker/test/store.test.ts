import { describe, expect, it } from "vitest";
import { SupabaseStore } from "../src/store";

/** Just enough of the Supabase query builder: select().in().order().range(), capped at 1000 rows like the real API. */
function fakeDb(rows: { id: number }[]) {
  const requests: number[] = [];
  return {
    requests,
    from() {
      let ids: number[] = [];
      let from = 0;
      let to = Infinity;
      const q = {
        select: () => q,
        order: () => q,
        in: (_col: string, v: number[]) => { ids = v; requests.push(v.length); return q; },
        range: (a: number, b: number) => { from = a; to = b; return q; },
        then(resolve: (r: { data: { id: number }[]; error: null }) => void) {
          const wanted = new Set(ids);
          const data = rows.filter((r) => wanted.has(r.id)).slice(from, Math.min(to + 1, from + 1000));
          resolve({ data, error: null });
        },
      };
      return q;
    },
  };
}

describe("SupabaseStore.companies", () => {
  it("loads every watched board, even past the 1000-row cap and in short URLs", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i + 1 }));
    const store = new SupabaseStore("http://localhost", "test-key");
    const db = fakeDb(rows);
    (store as unknown as { db: unknown }).db = db;

    const got = await store.companies(rows.map((r) => r.id));

    expect(got).toHaveLength(2500);
    expect(new Set(got.map((c) => c.id)).size).toBe(2500);
    expect(Math.max(...db.requests)).toBeLessThanOrEqual(100);
  });

  it("asks for nothing when no boards are watched", async () => {
    const store = new SupabaseStore("http://localhost", "test-key");
    const db = fakeDb([]);
    (store as unknown as { db: unknown }).db = db;
    expect(await store.companies([])).toEqual([]);
    expect(db.requests).toEqual([]);
  });
});
