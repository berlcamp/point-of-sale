// PostgREST caps every response at `max_rows` (1000 — see supabase/config.toml),
// and it does so silently: an unbounded `.select()` just stops at row 1000 with
// no error and no flag on the response. Ordered by name, that quietly amputates
// the tail of the catalog — products late in the alphabet became invisible to
// POS search, the inventory list and low-stock alerts.
//
// Anything that needs the *whole* table has to page through it explicitly.
export const PAGE_SIZE = 1000;

type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>;

// `build` is called once per page rather than being handed a prepared query:
// Supabase query builders are single-use thenables, so a builder that has been
// awaited can't be re-ranged and fired again.
export async function fetchAllRows<T>(build: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build(from, from + PAGE_SIZE - 1);
    if (error || !data) break;
    rows.push(...data);
    // A short page means we've reached the end of the table.
    if (data.length < PAGE_SIZE) break;
  }
  return rows;
}
