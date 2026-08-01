"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/Modal";
import { formatMoney, PAYMENT_METHODS, PAYMENT_TERMS_OPTIONS, QUICK_AMOUNTS } from "@/lib/config";
import type { ReceiptData } from "@/components/pos/ReceiptModal";
import type { PaymentMethod, Sale, SaleItem } from "@/lib/types";

type SaleWithItems = Sale & { sale_items: SaleItem[] };

// Where the money is actually recorded: the sales person built this cart, the
// customer carried its number over, and everything about how they are paying
// is decided here.
export function PaymentModal({
  sale,
  currency,
  onClose,
  onCompleted,
}: {
  sale: SaleWithItems;
  currency: string;
  onClose: () => void;
  onCompleted: (receipt: ReceiptData) => void;
}) {
  const supabase = createClient();
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [amountPaid, setAmountPaid] = useState(0);
  const [chequeDate, setChequeDate] = useState("");
  const [paymentTerms, setPaymentTerms] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = Number(sale.total);
  const isTerms = method === "terms";
  const change = isTerms ? 0 : amountPaid - total;

  const canConfirm =
    !submitting &&
    (isTerms
      ? paymentTerms !== ""
      : amountPaid > 0 && change >= 0 && (method !== "cheque" || chequeDate !== ""));

  const confirm = async () => {
    if (!canConfirm) return;
    setSubmitting(true);
    setError(null);

    const { data, error } = await supabase.rpc("complete_sale", {
      p_sale: sale.id,
      p_method: method,
      p_amount_paid: isTerms ? 0 : amountPaid,
      p_cheque_date: method === "cheque" ? chequeDate : null,
      p_terms: isTerms ? paymentTerms : null,
    });

    if (error) {
      setError(error.message);
      setSubmitting(false);
      return;
    }

    const done = data as ReceiptData;
    onCompleted({
      ...done,
      subtotal: Number(done.subtotal),
      discount: Number(done.discount),
      total: Number(done.total),
      amount_paid: Number(done.amount_paid),
      change: Number(done.change),
      items: (done.items ?? []).map((i) => ({
        ...i,
        quantity: Number(i.quantity),
        price: Number(i.price),
        total: Number(i.total),
      })),
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

  const ticket =
    sale.ticket_number === null ? "—" : String(sale.ticket_number).padStart(3, "0");

  return (
    <Modal
      title={`Transaction ${ticket}`}
      subtitle={sale.customer_name || "Walk-in customer"}
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
            {submitting ? "Completing…" : "Complete & Print"}
          </button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="rounded-xl border border-gray-100 divide-y divide-gray-100 text-sm">
          {(sale.sale_items ?? []).map((it) => (
            <div key={it.id} className="flex items-start justify-between gap-3 px-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-gray-800">{it.product_name}</span>
                <span className="text-xs text-gray-400 font-code">
                  ×{Number(it.quantity)} {it.unit_name} @ {formatMoney(it.price, currency)}
                </span>
              </span>
              <span className="font-amount whitespace-nowrap">
                {formatMoney(it.total, currency)}
              </span>
            </div>
          ))}
        </div>

        <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
          <Row label="Subtotal" value={formatMoney(sale.subtotal, currency)} />
          {Number(sale.discount) > 0 && (
            <Row label="Discount" value={`- ${formatMoney(sale.discount, currency)}`} />
          )}
          <div className="flex items-center justify-between pt-2 border-t border-gray-200">
            <span className="font-semibold text-gray-800">Total Due</span>
            <span className="text-xl font-bold text-blue-700 font-amount">
              {formatMoney(total, currency)}
            </span>
          </div>
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
              autoFocus
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

        {error && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            {error}
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
              {change >= 0 ? "Change to give" : "Insufficient"}
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
