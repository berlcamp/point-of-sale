// Platform-wide constants.

// The single platform super admin. Kept in sync with the DB trigger
// `handle_new_user()` which auto-provisions this email as super_admin.
export const SUPER_ADMIN_EMAIL = "berlcamp@gmail.com";

export const DB_SCHEMA = "point_of_sale";

export const DEFAULT_CURRENCY = "PHP";
export const DEFAULT_TERMINAL_ID = "POS-01";

export const PAYMENT_METHODS = [
  { value: "cash", label: "Cash", color: "emerald" },
  { value: "cheque", label: "Cheque", color: "violet" },
  { value: "terms", label: "Terms", color: "amber" },
] as const;

export const PAYMENT_TERMS_OPTIONS = [
  "7 days",
  "15 days",
  "30 days",
  "45 days",
  "60 days",
  "90 days",
] as const;

// Render a YYYY-MM-DD date column value without timezone drift.
export function formatDateOnly(d: string): string {
  return new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString();
}

// A cheque/terms sale is a collectible until an admin or manager marks it
// paid (sales.settled_at). Cash sales are paid at the register.
export function isUnsettledCollectible(sale: {
  payment_method: string;
  settled_at?: string | null;
  is_voided?: boolean;
}): boolean {
  return (
    (sale.payment_method === "cheque" || sale.payment_method === "terms") &&
    !sale.settled_at &&
    !sale.is_voided
  );
}

// When payment is expected: the date on the cheque, or the sale date plus the
// agreed terms ("30 days"). Null when there isn't enough info to tell.
export function collectibleDueDate(sale: {
  payment_method: string;
  cheque_date?: string | null;
  payment_terms?: string | null;
  created_at: string;
}): Date | null {
  if (sale.payment_method === "cheque" && sale.cheque_date) {
    return new Date(`${sale.cheque_date.slice(0, 10)}T00:00:00`);
  }
  if (sale.payment_method === "terms" && sale.payment_terms) {
    const days = parseInt(sale.payment_terms, 10);
    if (Number.isNaN(days)) return null;
    const due = new Date(sale.created_at);
    due.setDate(due.getDate() + days);
    return due;
  }
  return null;
}

// Secondary payment info shown next to the method: the cheque's date or the
// agreed terms. Null for plain methods (cash, legacy gcash/card rows).
export function paymentDetail(sale: {
  payment_method: string;
  cheque_date?: string | null;
  payment_terms?: string | null;
}): string | null {
  if (sale.payment_method === "cheque" && sale.cheque_date)
    return `Cheque date: ${formatDateOnly(sale.cheque_date)}`;
  if (sale.payment_method === "terms" && sale.payment_terms)
    return sale.payment_terms;
  return null;
}

export const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  admin: "Admin",
  manager: "Manager",
  cashier: "Cashier",
};

export const QUICK_AMOUNTS = [100, 200, 500, 1000, 2000, 5000];

export function formatMoney(value: number | string, currency = DEFAULT_CURRENCY): string {
  const n = Number(value) || 0;
  return `${currency} ${n.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
