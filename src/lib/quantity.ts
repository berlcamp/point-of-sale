// Quantities are fractional at the register — a customer can buy 0.25 kg — and
// the database stores them as numeric(14,4), so 4 decimals is the ceiling here.

export const QTY_DECIMALS = 4;

/** Snap to the column's precision so float noise never reaches the sale. */
export function roundQty(value: number): number {
  const factor = 10 ** QTY_DECIMALS;
  return Math.round(value * factor) / factor;
}

/** Parse cashier input like ".25" or "1.5". Returns null when unusable. */
export function parseQty(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return null;
  return roundQty(n);
}

/** Render without trailing zeros: 1 → "1", 0.25 → "0.25". */
export function formatQty(value: number): string {
  return String(roundQty(value));
}

/**
 * Arrow keys and the cart's +/- buttons move by whole units, keeping any
 * fraction intact (1.25 → 2.25 → 1.25). A decrement that would zero out the
 * line is ignored — removing an item is a separate, explicit action.
 */
export function stepQty(value: number, delta: number): number {
  const next = roundQty(value + delta);
  return next > 0 ? next : value;
}
