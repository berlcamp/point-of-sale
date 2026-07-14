"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/Modal";
import { formatMoney } from "@/lib/config";
import type { Sale } from "@/lib/types";
import { Ban } from "lucide-react";

const paymentPill: Record<string, string> = {
  cash: "bg-emerald-100 text-emerald-700",
  gcash: "bg-blue-100 text-blue-700",
  card: "bg-violet-100 text-violet-700",
};

export function SalesHistory({
  currency,
  canVoid,
  onClose,
}: {
  currency: string;
  canVoid: boolean;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [sales, setSales] = useState<(Sale & { itemCount: number })[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from("sales")
      .select("*, sale_items(id)")
      .gte("created_at", start.toISOString())
      .order("created_at", { ascending: false });
    setSales(
      ((data as (Sale & { sale_items: { id: string }[] })[]) ?? []).map((s) => ({
        ...s,
        itemCount: s.sale_items?.length ?? 0,
      }))
    );
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const voidSale = async (s: Sale) => {
    if (!confirm(`Void ${s.receipt_number}? Stock will be restored.`)) return;
    const { error } = await supabase.rpc("void_sale", { p_sale: s.id, p_reason: "Voided at POS" });
    if (error) alert(error.message);
    else load();
  };

  return (
    <Modal title="Sales Today" onClose={onClose} maxWidth="max-w-3xl">
      {loading ? (
        <div className="py-10 text-center text-gray-400">Loading…</div>
      ) : sales.length === 0 ? (
        <div className="py-10 text-center text-gray-400">No sales yet today.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left py-2">Receipt #</th>
              <th className="text-left py-2">Time</th>
              <th className="text-right py-2">Items</th>
              <th className="text-right py-2">Total</th>
              <th className="text-left py-2 pl-3">Payment</th>
              {canVoid && <th className="text-right py-2">Action</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sales.map((s) => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="py-2 font-code">
                  {s.receipt_number}
                  {s.is_voided && (
                    <span className="ml-2 px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-xs">VOIDED</span>
                  )}
                </td>
                <td className="py-2 text-gray-500">{new Date(s.created_at).toLocaleTimeString()}</td>
                <td className="py-2 text-right">{s.itemCount}</td>
                <td className="py-2 text-right font-amount">{formatMoney(s.total, currency)}</td>
                <td className="py-2 pl-3">
                  <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${paymentPill[s.payment_method] ?? "bg-gray-100"}`}>
                    {s.payment_method}
                  </span>
                </td>
                {canVoid && (
                  <td className="py-2 text-right">
                    {!s.is_voided && (
                      <button
                        onClick={() => voidSale(s)}
                        className="inline-flex items-center gap-1 text-red-600 hover:text-red-700 text-sm"
                      >
                        <Ban size={14} /> Void
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
