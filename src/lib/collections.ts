// =====================================================================
// Collections — what money actually changed hands in a period.
// =====================================================================
// Deliberately stricter than /admin/reports. Reports answers "what did we
// sell"; a remittance sheet answers "what is being counted out and handed
// over right now", and in this system those are not the same number:
//
//   cash sale      → money in the drawer, collected at the sale.
//   cheque / terms → a RECEIVABLE. `isCollectible()` in lib/config treats
//                    both as outstanding until an admin settles them, so
//                    neither is money the person on shift can turn over.
//   settlement     → the moment a cheque/terms sale is marked paid. THAT
//                    is when its money is collected, on the settlement
//                    date, by whoever settled it — not on the sale date.
//
// Counting a terms sale as collected would inflate a shift's turnover by
// the full face value of goods that were taken away on credit, which is
// exactly the error a signed remittance sheet exists to prevent.
//
// Pure functions only — no Supabase, no React — so the arithmetic can be
// exercised directly.

import { PAYMENT_METHODS } from "@/lib/config";
import type { PaymentMethod } from "@/lib/types";

/** Why a row is on the sheet. */
export type CollectionKind =
  /** Cash taken at the point of sale. Counted out at turnover. */
  | "cash"
  /** Cheque/terms sale raised in this period. Collected nothing yet. */
  | "receivable"
  /** A previously-raised cheque/terms sale marked paid in this period. */
  | "settlement";

export type CollectionRow = {
  id: string;
  kind: CollectionKind;
  receiptNumber: string;
  ticketNumber: number | null;
  customerName: string | null;
  method: PaymentMethod | string | null;
  /** Face value of the sale. */
  total: number;
  /** Money that moved in THIS period. Zero for receivables. */
  collected: number;
  /** When the money moved — settlement date for settlements. */
  at: string;
  handledById: string | null;
  handledByName: string | null;
  /** Cheque date or agreed terms, when the method carries one. */
  detail: string | null;
};

export type Bucket = { key: string; label: string; count: number; amount: number };

export type DailyBucket = {
  date: string;
  count: number;
  cash: number;
  total: number;
};

export type CollectionsReport = {
  /** Notes and coins to be counted out. The figure the signatures are about. */
  cash: number;
  /** Collected, but already banked or in hand as paper — settled receivables. */
  nonCash: number;
  /** cash + nonCash. */
  total: number;
  /** Transactions that moved money. Receivables are excluded by design. */
  count: number;
  /** Credit extended in this period — on the sheet, but never in `total`. */
  receivableAmount: number;
  receivableCount: number;
  byMethod: Bucket[];
  byPerson: Bucket[];
  daily: DailyBucket[];
  /** Every row, money-moving or not, oldest first. */
  rows: CollectionRow[];
};

const METHOD_LABELS = new Map<string, string>(
  PAYMENT_METHODS.map((m) => [m.value, m.label])
);

/** Falls back to the raw value so legacy rows (gcash, card) still read sanely. */
export function methodLabel(method: string | null | undefined): string {
  if (!method) return "—";
  return METHOD_LABELS.get(method) ?? method.charAt(0).toUpperCase() + method.slice(1);
}

/** Local calendar day. Not toISOString(), which would bucket a 7am PH sale
 *  into the previous day. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function bump(map: Map<string, Bucket>, key: string, label: string, amount: number) {
  const b = map.get(key) ?? { key, label, count: 0, amount: 0 };
  b.count += 1;
  b.amount += amount;
  map.set(key, b);
}

/**
 * Rolls a set of rows into the figures the sheet prints.
 *
 * `rows` may arrive in any order and from either query (sales, settlements);
 * ordering and bucketing happen here so the screen, the print sheet and the
 * CSV can never disagree about a total.
 */
export function computeCollections(rows: CollectionRow[]): CollectionsReport {
  const sorted = [...rows].sort((a, b) => a.at.localeCompare(b.at));

  let cash = 0;
  let nonCash = 0;
  let count = 0;
  let receivableAmount = 0;
  let receivableCount = 0;

  const byMethod = new Map<string, Bucket>();
  const byPerson = new Map<string, Bucket>();
  const byDay = new Map<string, DailyBucket>();

  for (const r of sorted) {
    if (r.kind === "receivable") {
      receivableAmount += r.total;
      receivableCount += 1;
      // Intentionally absent from byMethod/byPerson/daily: those three feed
      // the collected totals, and a receivable collected nothing.
      continue;
    }

    if (r.kind === "cash") cash += r.collected;
    else nonCash += r.collected;
    count += 1;

    bump(byMethod, r.method ?? "unknown", methodLabel(r.method), r.collected);
    bump(
      byPerson,
      r.handledById ?? r.handledByName ?? "unattributed",
      r.handledByName ?? "Unattributed",
      r.collected
    );

    const day = localDay(r.at);
    const d = byDay.get(day) ?? { date: day, count: 0, cash: 0, total: 0 };
    d.count += 1;
    d.cash += r.kind === "cash" ? r.collected : 0;
    d.total += r.collected;
    byDay.set(day, d);
  }

  const desc = (a: Bucket, b: Bucket) => b.amount - a.amount;

  return {
    cash,
    nonCash,
    total: cash + nonCash,
    count,
    receivableAmount,
    receivableCount,
    byMethod: [...byMethod.values()].sort(desc),
    byPerson: [...byPerson.values()].sort(desc),
    daily: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    rows: sorted,
  };
}
