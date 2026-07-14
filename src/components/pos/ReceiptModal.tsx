"use client";

import { formatMoney } from "@/lib/config";
import { Printer, Plus, CloudOff } from "lucide-react";

export interface ReceiptData {
  receipt_number: string;
  created_at: string;
  subtotal: number;
  discount: number;
  total: number;
  amount_paid: number;
  change: number;
  payment_method: string;
  cashier_name: string;
  items: {
    product_name: string;
    unit_name: string;
    quantity: number;
    price: number;
    total: number;
  }[];
  offline?: boolean;
}

export function ReceiptModal({
  receipt,
  companyName,
  currency,
  onNewTransaction,
}: {
  receipt: ReceiptData;
  companyName: string;
  currency: string;
  onNewTransaction: () => void;
}) {
  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.65)", backdropFilter: "blur(4px)" }}
    >
      <div className="modal-panel w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="receipt-print overflow-auto p-6">
          <div className="text-center">
            <h2 className="text-lg font-bold">{companyName}</h2>
            <p className="text-xs text-gray-500">Official Receipt</p>
            <p className="font-code text-sm mt-2">{receipt.receipt_number}</p>
            <p className="text-xs text-gray-400">
              {new Date(receipt.created_at).toLocaleString()}
            </p>
            {receipt.offline && (
              <p className="mt-1 inline-flex items-center gap-1 text-xs text-amber-600">
                <CloudOff size={12} /> Queued — will sync when online
              </p>
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
            <Line label="Subtotal" value={formatMoney(receipt.subtotal, currency)} />
            {receipt.discount > 0 && (
              <Line label="Discount" value={`- ${formatMoney(receipt.discount, currency)}`} />
            )}
            <div className="flex justify-between font-bold text-base pt-1">
              <span>Total</span>
              <span className="font-amount">{formatMoney(receipt.total, currency)}</span>
            </div>
            <Line
              label={`Paid (${receipt.payment_method})`}
              value={formatMoney(receipt.amount_paid, currency)}
            />
            <Line label="Change" value={formatMoney(receipt.change, currency)} />
          </div>

          <hr className="receipt-dash my-4" />
          <p className="text-center text-xs text-gray-400">
            Served by {receipt.cashier_name}
          </p>
          <p className="text-center text-sm mt-1 font-medium">Thank you!</p>
        </div>

        <div className="no-print border-t border-gray-100 p-4 flex gap-2 bg-gray-50">
          <button
            onClick={() => window.print()}
            className="flex-1 flex items-center justify-center gap-2 border border-gray-300 hover:bg-gray-100 rounded-lg py-2.5 text-sm font-medium text-gray-700"
          >
            <Printer size={16} /> Print
          </button>
          <button
            onClick={onNewTransaction}
            className="flex-1 flex items-center justify-center gap-2 bg-blue-700 hover:bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium"
          >
            <Plus size={16} /> New Transaction
          </button>
        </div>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-gray-600">
      <span>{label}</span>
      <span className="font-amount">{value}</span>
    </div>
  );
}
