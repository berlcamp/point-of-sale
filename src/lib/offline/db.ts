import Dexie, { type Table } from "dexie";
import type { Product, CreateSalePayload, Profile } from "@/lib/types";

// The signed-in user's profile, mirrored locally so the terminal can boot and
// authenticate offline after being provisioned online at least once.
export interface CachedSession {
  key: string; // always "current" — one active user per terminal
  profile: Profile;
  cachedAt: string;
  pinSalt?: string; // present once a local unlock PIN is configured
  pinHash?: string;
}

// A queued sale awaiting sync, plus the receipt snapshot for offline display.
export interface OutboxSale {
  id: string; // = sale id (idempotency key)
  payload: CreateSalePayload;
  receipt: {
    receipt_number: string;
    customer_name?: string;
    total: number;
    subtotal: number;
    discount: number;
    amount_paid: number;
    change: number;
    payment_method: string;
    created_at: string;
    cashier_name: string;
    items: {
      product_name: string;
      unit_name: string;
      quantity: number;
      price: number;
      total: number;
    }[];
  };
  created_at: string;
  synced: 0 | 1;
  attempts: number;
  last_error?: string;
}

class PosDB extends Dexie {
  products!: Table<Product & { company_id: string }, string>;
  outbox!: Table<OutboxSale, string>;
  session!: Table<CachedSession, string>;

  constructor() {
    super("pointone-pos");
    this.version(1).stores({
      products: "id, company_id, name, sku, barcode",
      outbox: "id, synced, created_at",
    });
    // v2: mirror the signed-in profile for offline boot / PIN unlock.
    this.version(2).stores({
      session: "key",
    });
  }
}

// Guard against SSR — Dexie only exists in the browser.
export const db = typeof window !== "undefined" ? new PosDB() : (null as unknown as PosDB);
