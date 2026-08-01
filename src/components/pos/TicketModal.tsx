"use client";

import { formatMoney } from "@/lib/config";
import { Plus, Banknote } from "lucide-react";

export interface TicketData {
  ticket_number: number | null;
  receipt_number: string;
  customer_name?: string | null;
  total: number;
  item_count: number;
}

// Shown after a cart is sent to the cashier booth. The number is the whole
// point of this screen — the customer carries it to the booth — so it is set
// as large as the panel allows and everything else stays secondary.
export function TicketModal({
  ticket,
  currency,
  onNewTransaction,
}: {
  ticket: TicketData;
  currency: string;
  onNewTransaction: () => void;
}) {
  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(15,23,42,0.65)", backdropFilter: "blur(4px)" }}
    >
      <div className="modal-panel w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="p-6 text-center">
          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-full px-3 py-1">
            <Banknote size={14} /> Send the customer to the cashier
          </div>

          <p className="text-xs uppercase tracking-wide text-gray-400 mt-6">
            Transaction number
          </p>
          <p className="text-7xl font-bold text-gray-900 leading-none mt-1 font-amount">
            {ticket.ticket_number === null
              ? "—"
              : String(ticket.ticket_number).padStart(3, "0")}
          </p>

          <div className="mt-6 rounded-xl bg-gray-50 p-4 space-y-1.5 text-sm text-left">
            <Row label="Amount due" value={formatMoney(ticket.total, currency)} strong />
            <Row
              label="Items"
              value={`${ticket.item_count} item${ticket.item_count === 1 ? "" : "s"}`}
            />
            {ticket.customer_name && <Row label="Customer" value={ticket.customer_name} />}
            <Row label="Receipt #" value={ticket.receipt_number} code />
          </div>

          <p className="text-xs text-gray-400 mt-4">
            The cashier takes the payment, prints the receipt and gives the
            change. Nothing further is needed on this terminal.
          </p>
        </div>

        <div className="border-t border-gray-100 p-4 bg-gray-50">
          <button
            onClick={onNewTransaction}
            className="w-full flex items-center justify-center gap-2 bg-blue-700 hover:bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium"
          >
            <Plus size={16} /> New Transaction
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong = false,
  code = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  code?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-gray-500">{label}</span>
      <span
        className={`${strong ? "font-bold text-gray-900" : "text-gray-700"} ${
          code ? "font-code text-xs" : "font-amount"
        } truncate`}
      >
        {value}
      </span>
    </div>
  );
}
