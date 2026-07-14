"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/Modal";
import { DeliveryReceipt } from "@/components/pos/DeliveryReceipt";
import type { ReceiptData } from "@/components/pos/ReceiptModal";
import type { Sale, SaleItem } from "@/lib/types";
import { Printer } from "lucide-react";

// Reprint a delivery receipt for an existing sale. Fetches the sale's line items
// (list queries don't include them) and renders the shared DeliveryReceipt slip.
// Never mounted alongside the post-sale ReceiptModal, so sharing `.receipt-print`
// is safe here.
export function DeliveryReceiptModal({
  sale,
  companyName,
  currency,
  onClose,
}: {
  sale: Sale;
  companyName: string;
  currency: string;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [items, setItems] = useState<SaleItem[] | null>(null);

  useEffect(() => {
    supabase
      .from("sale_items")
      .select("*")
      .eq("sale_id", sale.id)
      .then(({ data }) => setItems((data as SaleItem[]) ?? []));
  }, [supabase, sale.id]);

  const receipt: ReceiptData | null = items
    ? {
        receipt_number: sale.receipt_number,
        customer_name: sale.customer_name,
        created_at: sale.created_at,
        subtotal: Number(sale.subtotal),
        discount: Number(sale.discount),
        total: Number(sale.total),
        amount_paid: Number(sale.amount_paid),
        change: Number(sale.change),
        payment_method: sale.payment_method,
        cashier_name: sale.cashier_name ?? "",
        items: items.map((it) => ({
          product_name: it.product_name,
          unit_name: it.unit_name,
          quantity: Number(it.quantity),
          price: Number(it.price),
          total: Number(it.total),
        })),
      }
    : null;

  return (
    <Modal
      title="Delivery Receipt"
      subtitle={sale.receipt_number}
      onClose={onClose}
      maxWidth="max-w-sm"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100"
          >
            Close
          </button>
          <button
            onClick={() => window.print()}
            disabled={!receipt}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50"
          >
            <Printer size={16} /> Print
          </button>
        </div>
      }
    >
      {receipt ? (
        <DeliveryReceipt receipt={receipt} companyName={companyName} currency={currency} />
      ) : (
        <div className="py-10 text-center text-gray-400">Loading…</div>
      )}
    </Modal>
  );
}
