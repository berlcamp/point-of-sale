"use client";

import { formatMoney, paymentDetail } from "@/lib/config";
import type { ReceiptData } from "@/components/pos/ReceiptModal";

// The printable warehouse release slip. Presentational only — wrap it in a modal
// (or render it inline) and trigger printing with window.print(). It reuses the
// shared `.receipt-print` class + the `@media print` rules in globals.css, so it
// prints as an isolated roll-width document (--receipt-width, from the printer
// settings). Only one `.receipt-print` block may be mounted when printing, or
// the browser will emit both documents at once. Thermal printing bypasses this
// component entirely — see lib/printer/encode.ts.
export function DeliveryReceipt({
  receipt,
  companyName,
  currency,
}: {
  receipt: ReceiptData;
  companyName: string;
  currency: string;
}) {
  return (
    <div className="receipt-print overflow-auto p-6">
      <div className="text-center">
        <h2 className="text-lg font-bold">{companyName}</h2>
        <p className="text-xs font-semibold tracking-wide text-gray-700">
          DELIVERY RECEIPT
        </p>
        <p className="text-[11px] text-gray-500">Warehouse Release Slip</p>
      </div>

      <div className="mt-3 rounded-md border border-dashed border-gray-400 px-3 py-2 text-center">
        <p className="text-[11px] leading-tight text-gray-600">
          Present this slip to the warehouse to claim your items.
        </p>
      </div>

      <div className="mt-3 text-center">
        <p className="text-[10px] uppercase tracking-wide text-gray-400">
          Claim reference
        </p>
        <p className="font-code text-sm">{receipt.receipt_number}</p>
        <p className="text-xs text-gray-400">
          {new Date(receipt.created_at).toLocaleString()}
        </p>
        {receipt.customer_name && (
          <p className="mt-1 text-sm font-medium">Customer: {receipt.customer_name}</p>
        )}
      </div>

      <hr className="receipt-dash my-4" />

      <div className="space-y-1.5 text-sm">
        {receipt.items.map((it, i) => (
          <div key={i} className="flex justify-between">
            <span className="min-w-0">
              <span className="block truncate">{it.product_name}</span>
              <span className="text-xs text-gray-400 font-code">
                ×{it.quantity} {it.unit_name} @ {formatMoney(it.price, currency)}
              </span>
            </span>
            <span className="font-amount whitespace-nowrap ml-2">
              {formatMoney(it.total, currency)}
            </span>
          </div>
        ))}
      </div>

      <hr className="receipt-dash my-4" />

      <div className="space-y-1 text-sm">
        <div className="flex justify-between text-gray-600">
          <span>Subtotal</span>
          <span className="font-amount">{formatMoney(receipt.subtotal, currency)}</span>
        </div>
        {receipt.discount > 0 && (
          <div className="flex justify-between text-gray-600">
            <span>Discount</span>
            <span className="font-amount">- {formatMoney(receipt.discount, currency)}</span>
          </div>
        )}
        <div className="flex justify-between font-bold text-base pt-1">
          <span>Total</span>
          <span className="font-amount">{formatMoney(receipt.total, currency)}</span>
        </div>
        <div className="flex items-center justify-between pt-1">
          {receipt.payment_method === "terms" ? (
            <span className="inline-flex items-center rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
              ON TERMS
            </span>
          ) : (
            <span className="inline-flex items-center rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
              PAID
            </span>
          )}
          <span className="text-xs capitalize text-gray-500">
            {receipt.payment_method}
            {paymentDetail(receipt) ? ` · ${paymentDetail(receipt)}` : ""}
          </span>
        </div>
      </div>

      <hr className="receipt-dash my-4" />

      <div className="grid grid-cols-2 gap-4 pt-6 text-center text-[10px] text-gray-500">
        <div>
          <div className="border-t border-gray-400 pt-1">Released by</div>
          <div className="text-gray-400">Warehouse</div>
        </div>
        <div>
          <div className="border-t border-gray-400 pt-1">Received by</div>
          <div className="text-gray-400">Customer</div>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-gray-400">
        Served by {receipt.cashier_name}
      </p>
    </div>
  );
}
