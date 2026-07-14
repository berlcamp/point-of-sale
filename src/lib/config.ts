// Platform-wide constants.

// The single platform super admin. Kept in sync with the DB trigger
// `handle_new_user()` which auto-provisions this email as super_admin.
export const SUPER_ADMIN_EMAIL = "berlcamp@gmail.com";

export const DB_SCHEMA = "point_of_sale";

export const DEFAULT_CURRENCY = "PHP";
export const DEFAULT_TERMINAL_ID = "POS-01";

export const PAYMENT_METHODS = [
  { value: "cash", label: "Cash", color: "emerald" },
  { value: "gcash", label: "GCash", color: "blue" },
  { value: "card", label: "Card", color: "violet" },
] as const;

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
