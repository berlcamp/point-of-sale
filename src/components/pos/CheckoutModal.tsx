"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { formatMoney, PAYMENT_METHODS, PAYMENT_TERMS_OPTIONS, QUICK_AMOUNTS } from "@/lib/config";
import type { PaymentMethod } from "@/lib/types";

export interface CheckoutDetails {
  amountPaid: number;
  discount: number;
  method: PaymentMethod;
  customerName: string;
  chequeDate?: string; // YYYY-MM-DD, when method = 'cheque'
  paymentTerms?: string; // when method = 'terms'
}

interface Props {
  subtotal: number;
  itemCount: number;
  currency: string;
  onConfirm: (details: CheckoutDetails) => void;
  onClose: () => void;
}

export function CheckoutModal({ subtotal, itemCount, currency, onConfirm, onClose }: Props) {
  const [discount, setDiscount] = useState(0);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [amountPaid, setAmountPaid] = useState<number>(0);
  const [customerName, setCustomerName] = useState("");
  const [chequeDate, setChequeDate] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const total = Math.max(0, subtotal - discount);
  // Terms sales are charged, not paid at the register — nothing is tendered.
  const isTerms = method === "terms";
  const change = isTerms ? 0 : amountPaid - total;

  const canConfirm =
    !submitting &&
    (isTerms
      ? paymentTerms !== ""
      : amountPaid > 0 && change >= 0 && (method !== "cheque" || chequeDate !== ""));

  const confirm = () => {
    if (!canConfirm) return;
    setSubmitting(true);
    onConfirm({
      amountPaid: isTerms ? 0 : amountPaid,
      discount,
      method,
      customerName: customerName.trim(),
      chequeDate: method === "cheque" ? chequeDate : undefined,
      paymentTerms: isTerms ? paymentTerms : undefined,
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && canConfirm) confirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canConfirm]);

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
            disabled={!canConfirm}
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

        {method === "cheque" && (
          <div>
            <span className="block text-xs font-medium text-gray-500 mb-2">Cheque Date</span>
            <input
              type="date"
              value={chequeDate}
              onChange={(e) => setChequeDate(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
        )}

        {isTerms && (
          <div>
            <span className="block text-xs font-medium text-gray-500 mb-2">Payment Terms</span>
            <select
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="">Select terms…</option>
              {PAYMENT_TERMS_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        )}

        {!isTerms && (
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
        )}

        {isTerms ? (
          <div className="rounded-xl p-4 flex items-center justify-between bg-amber-50">
            <span className="text-amber-700">
              Balance Due{paymentTerms ? ` · ${paymentTerms}` : ""}
            </span>
            <span className="text-xl font-bold font-amount text-amber-700">
              {formatMoney(total, currency)}
            </span>
          </div>
        ) : (
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
        )}
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
