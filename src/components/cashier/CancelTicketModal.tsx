"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/Modal";
import { formatMoney } from "@/lib/config";
import type { Sale } from "@/lib/types";
import { AlertTriangle } from "lucide-react";

// Cancelling an unpaid ticket — the customer changed their mind on the way to
// the booth. It runs through void_sale, which is what puts the reserved stock
// back on the shelf.
export function CancelTicketModal({
  sale,
  currency,
  onClose,
  onCancelled,
}: {
  sale: Sale;
  currency: string;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const supabase = createClient();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ticket =
    sale.ticket_number === null ? sale.receipt_number : String(sale.ticket_number).padStart(3, "0");

  const submit = async () => {
    setSaving(true);
    setError(null);
    const { error } = await supabase.rpc("void_sale", {
      p_sale: sale.id,
      p_reason: reason.trim() || "Cancelled at the cashier booth",
    });
    if (error) {
      setError(error.message);
      setSaving(false);
      return;
    }
    onCancelled();
  };

  return (
    <Modal
      title="Cancel Transaction"
      subtitle={`Transaction ${ticket}`}
      onClose={onClose}
      maxWidth="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100">
            Keep it
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold disabled:opacity-40"
          >
            {saving ? "Cancelling…" : "Cancel Transaction"}
          </button>
        </div>
      }
    >
      <div className="flex items-start gap-3 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
        <AlertTriangle size={18} className="mt-0.5 shrink-0" />
        <p>
          The {formatMoney(sale.total, currency)} transaction for{" "}
          <span className="font-medium">{sale.customer_name || "a walk-in customer"}</span> will be
          cancelled and its items returned to stock. This cannot be undone.
        </p>
      </div>

      <label className="block mt-4">
        <span className="block text-xs font-medium text-gray-500 mb-1">
          Reason <span className="text-gray-400 font-normal">(optional)</span>
        </span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          autoFocus
          placeholder="Customer changed their mind"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 outline-none"
        />
      </label>

      {error && (
        <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
    </Modal>
  );
}
