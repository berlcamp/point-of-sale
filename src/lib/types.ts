// Domain types — snake_case to match the `point_of_sale` Postgres schema directly.

export type Role = "super_admin" | "admin" | "manager" | "cashier";
export type PaymentMethod = "cash" | "cheque" | "terms";
export type MovementType = "SALE" | "RESTOCK" | "ADJUSTMENT" | "RETURN";
export type ReturnType = "VOID" | "RETURN";
export type InvitationStatus = "pending" | "accepted";

export interface Company {
  id: string;
  name: string;
  slug: string;
  address: string | null;
  phone: string | null;
  logo_url: string | null;
  login_bg_url: string | null;
  currency: string;
  is_active: boolean;
  created_at: string;
}

export interface Profile {
  id: string;
  company_id: string | null;
  full_name: string | null;
  email: string;
  role: Role;
  is_active: boolean;
  created_at: string;
  company?: Company | null;
}

export interface Invitation {
  id: string;
  company_id: string;
  email: string;
  role: Role;
  invited_by: string | null;
  status: InvitationStatus;
  created_at: string;
}

export interface ProductUnit {
  id: string;
  company_id: string;
  product_id: string;
  unit_name: string;
  conversion_factor: number;
  price: number;
}

export interface Product {
  id: string;
  company_id: string;
  name: string;
  description: string | null;
  sku: string;
  barcode: string | null;
  base_price: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  units: ProductUnit[];
  inventory?: { quantity: number; low_stock: number } | null;
}

export interface CartItem {
  product_id: string;
  product_name: string;
  unit_name: string;
  quantity: number;
  price: number;
  cost_price: number;
  discount: number;
  total: number;
  max_stock: number;
  conversion_factor: number;
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string;
  product_name: string;
  unit_name: string;
  quantity: number;
  price: number;
  cost_price: number;
  discount: number;
  total: number;
}

export interface Sale {
  id: string;
  company_id: string;
  receipt_number: string;
  customer_id: string | null;
  customer_name: string | null;
  subtotal: number;
  discount: number;
  total: number;
  payment_method: PaymentMethod;
  cheque_date: string | null; // set when payment_method = 'cheque'
  payment_terms: string | null; // set when payment_method = 'terms'
  settled_at: string | null; // cheque/terms only: when the payment was collected
  settled_by_name: string | null;
  amount_paid: number;
  change: number;
  cashier_id: string | null;
  cashier_name: string | null;
  terminal_id: string | null;
  is_voided: boolean;
  created_at: string;
  items?: SaleItem[];
}

export interface InventoryRow {
  id: string;
  company_id: string;
  product_id: string;
  quantity: number;
  low_stock: number;
  updated_at: string;
  product?: Product;
}

export interface StockBatch {
  id: string;
  company_id: string;
  product_id: string;
  quantity: number;
  initial_qty: number;
  cost_price: number;
  reference: string | null;
  received_at: string;
  user_name: string | null;
}

export interface InventoryMovement {
  id: string;
  company_id: string;
  product_id: string;
  type: MovementType;
  quantity: number;
  previous_qty: number;
  new_qty: number;
  reason: string | null;
  reference_id: string | null;
  user_name: string | null;
  created_at: string;
  product?: Product;
}

export interface AuditLog {
  id: string;
  company_id: string;
  user_id: string | null;
  user_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

// Payload sent to the `create_sale` RPC (works online and from the offline outbox).
export interface CreateSalePayload {
  id: string; // client-generated UUID for idempotency
  receipt_number: string;
  customer_name?: string;
  discount: number;
  amount_paid: number;
  payment_method: PaymentMethod;
  cheque_date?: string; // required when payment_method = 'cheque'
  payment_terms?: string; // required when payment_method = 'terms'
  terminal_id: string;
  created_at: string;
  items: {
    product_id: string;
    product_name: string;
    unit_name: string;
    quantity: number;
    price: number;
    discount: number;
  }[];
}
