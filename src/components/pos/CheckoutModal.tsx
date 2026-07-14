"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { formatMoney, PAYMENT_METHODS, QUICK_AMOUNTS } from "@/lib/config";
import type { PaymentMethod } from "@/lib/types";

interface Props {
  subtotal: number;
  itemCount: number;
  currency: string;
  onConfirm: (amountPaid: number, discount: number, method: PaymentMethod, customerName: string) => void;
  onClose: () => void;
}

export function CheckoutModal({ subtotal, itemCount, currency, onConfirm, onClose }: Props) {
  const [discount, setDiscount] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [amountPaid, setAmountPaid] = useState<number>(0);
  const [customerName, setCustomerName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const total = Math.max(0, subtotal - discount);
  const change = amountPaid - total;

  const confirm = () => {
    setSubmitting(true);
    onConfirm(amountPaid, discount, method, customerName.trim());
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && change >= 0 && amountPaid > 0 && !submitting) confirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [change, amountPaid, submitting]);

  return (
    <Modal
      title="Checkout"
      subtitle={`${itemCount} item${itemCount === 1 ? "" : "s"}`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={change < 0 || amountPaid <= 0 || submitting}
            className="px-5 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white font-semibold disabled:opacity-40"
          >
            {submitting ? "Processing…" : "Complete Sale"}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="bg-gray-50 rounded-xl p-4 space-y-2">
          <Row label="Subtotal" value={formatMoney(subtotal, currency)} />
          <div className="flex items-center justify-between">
            <span className="text-gray-600">Discount</span>
            <input
              type="number"
              min={0}
              value={discount || ""}
              onChange={(e) => setDiscount(Math.max(0, Number(e.target.value) || 0))}
              placeholder="0.00"
              className="w-28 border border-gray-300 rounded-lg px-2 py-1 text-right text-sm"
            />
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-gray-200">
            <span className="font-semibold text-gray-800">Total Due</span>
            <span className="text-xl font-bold text-blue-700 font-amount">{formatMoney(total, currency)}</span>
          </div>
        </div>

        <div>
          <span className="block text-xs font-medium text-gray-500 mb-2">
            Customer Name <span className="text-gray-400 font-normal">(optional)</span>
          </span>
          <input
            type="text"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Walk-in customer"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        <div>
          <span className="block text-xs font-medium text-gray-500 mb-2">Payment Method</span>
          <div className="grid grid-cols-3 gap-2">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m.value}
                onClick={() => setMethod(m.value as PaymentMethod)}
                className={`py-2.5 rounded-lg text-sm font-medium border transition ${
                  method === m.value
                    ? "bg-blue-700 text-white border-blue-700"
                    : "bg-white text-gray-600 border-gray-200 hover:border-blue-300"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="block text-xs font-medium text-gray-500 mb-2">Amount Tendered</span>
          <input
            type="number"
            value={amountPaid || ""}
            onChange={(e) => setAmountPaid(Number(e.target.value) || 0)}
            placeholder="0.00"
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-lg font-amount focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <div className="flex flex-wrap gap-2 mt-2">
            {QUICK_AMOUNTS.map((a) => (
              <button
                key={a}
                onClick={() => setAmountPaid(a)}
                className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm hover:bg-gray-50"
              >
                {a.toLocaleString()}
              </button>
            ))}
            <button
              onClick={() => setAmountPaid(Math.ceil(total))}
              className="px-3 py-1.5 rounded-lg border border-blue-200 text-blue-700 text-sm hover:bg-blue-50"
            >
              Exact
            </button>
          </div>
        </div>

        <div
          className={`rounded-xl p-4 flex items-center justify-between ${
            change >= 0 ? "bg-emerald-50" : "bg-red-50"
          }`}
        >
          <span className={change >= 0 ? "text-emerald-700" : "text-red-700"}>
            {change >= 0 ? "Change" : "Insufficient"}
          </span>
          <span
            className={`text-xl font-bold font-amount ${
              change >= 0 ? "text-emerald-700" : "text-red-700"
            }`}
          >
            {formatMoney(Math.abs(change), currency)}
          </span>
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-600">{label}</span>
      <span className="font-amount">{value}</span>
    </div>
  );
}
