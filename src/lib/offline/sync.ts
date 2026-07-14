import { db, type OutboxSale } from "@/lib/offline/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Product } from "@/lib/types";

// Schema-agnostic client type (the app scopes clients to point_of_sale).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any, any, any>;

// ---- Product mirror (for offline browsing) ---------------------------------

export async function cacheProducts(companyId: string, products: Product[]) {
  if (!db) return;
  await db.transaction("rw", db.products, async () => {
    await db.products.where("company_id").equals(companyId).delete();
    await db.products.bulkPut(products.map((p) => ({ ...p, company_id: companyId })));
  });
}

export async function getCachedProducts(companyId: string): Promise<Product[]> {
  if (!db) return [];
  return db.products.where("company_id").equals(companyId).toArray();
}

// ---- Outbox (pending offline sales) ----------------------------------------

export async function enqueueSale(sale: OutboxSale) {
  if (!db) return;
  await db.outbox.put(sale);
}

export async function pendingCount(): Promise<number> {
  if (!db) return 0;
  return db.outbox.where("synced").equals(0).count();
}

// Push all queued sales to Supabase. The create_sale RPC is idempotent
// (keyed on the sale id), so replays are safe. Returns how many synced.
export async function flushOutbox(supabase: AnyClient): Promise<number> {
  if (!db) return 0;
  const pending = await db.outbox.where("synced").equals(0).toArray();
  let synced = 0;
  for (const sale of pending) {
    const { error } = await supabase.rpc("create_sale", { payload: sale.payload });
    if (error) {
      await db.outbox.update(sale.id, {
        attempts: sale.attempts + 1,
        last_error: error.message,
      });
    } else {
      await db.outbox.update(sale.id, { synced: 1 });
      synced++;
    }
  }
  // Tidy up successfully synced rows.
  await db.outbox.where("synced").equals(1).delete();
  return synced;
}

export function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}
