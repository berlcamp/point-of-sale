"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Modal } from "@/components/Modal";
import { Pagination } from "@/components/Pagination";
import { DeliveryReceiptModal } from "@/components/pos/DeliveryReceiptModal";
import { formatMoney, isUnsettledCollectible, paymentDetail } from "@/lib/config";
import type { Sale } from "@/lib/types";
import { Ban, Truck, Search, AlertTriangle } from "lucide-react";

const paymentPill: Record<string, string> = {
  cash: "bg-emerald-100 text-emerald-700",
  cheque: "bg-violet-100 text-violet-700",
  terms: "bg-amber-100 text-amber-700",
};

const PAGE_SIZE = 10;

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function SalesHistory({
  companyName,
  currency,
  canVoid,
  cashierId,
  onClose,
}: {
  companyName: string;
  currency: string;
  canVoid: boolean;
  cashierId: string;
  onClose: () => void;
}) {
  const supabase = createClient();
  const [sales, setSales] = useState<(Sale & { itemCount: number })[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [date, setDate] = useState(todayStr());
  const [loading, setLoading] = useState(true);
  const [printSale, setPrintSale] = useState<Sale | null>(null);
  const [voidFor, setVoidFor] = useState<Sale | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // Bounds for the selected day, in the browser's local timezone.
    const start = new Date(`${date}T00:00:00`);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const term = search.trim();
    let q = supabase
      .from("sales")
      .select("*, sale_items(id)", { count: "exact" })
      .eq("cashier_id", cashierId)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .order("created_at", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    if (term) q = q.or(`receipt_number.ilike.%${term}%,customer_name.ilike.%${term}%`);
    const { data, count } = await q;
    setSales(
      ((data as (Sale & { sale_items: { id: string }[] })[]) ?? []).map((s) => ({
        ...s,
        itemCount: s.sale_items?.length ?? 0,
      }))
    );
    setTotal(count ?? 0);
    setLoading(false);
  }, [supabase, page, search, date, cashierId]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <Modal title="Sales" onClose={onClose} maxWidth="max-w-3xl">
        <div className="mb-3 flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search by receipt # or customer name…"
              className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setPage(1);
            }}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>

        {loading ? (
          <div className="py-10 text-center text-gray-400">Loading…</div>
        ) : sales.length === 0 ? (
          <div className="py-10 text-center text-gray-400">
            {search.trim() ? "No sales match your search." : "No sales for this date."}
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead className="text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left py-2">Receipt #</th>
                  <th className="text-left py-2 pl-3">Customer</th>
                  <th className="text-left py-2">Time</th>
                  <th className="text-right py-2">Items</th>
                  <th className="text-right py-2">Total</th>
                  <th className="text-left py-2 pl-3">Payment</th>
                  <th className="text-right py-2">Actions</th>
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
                    <td className="py-2 pl-3 text-gray-700">{s.customer_name || <span className="text-gray-300">—</span>}</td>
                    <td className="py-2 text-gray-500">{new Date(s.created_at).toLocaleTimeString()}</td>
                    <td className="py-2 text-right">{s.itemCount}</td>
                    <td className="py-2 text-right font-amount">{formatMoney(s.total, currency)}</td>
                    <td className="py-2 pl-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${paymentPill[s.payment_method] ?? "bg-gray-100"}`}>
                        {s.payment_method}
                      </span>
                      {isUnsettledCollectible(s) && (
                        <span className="ml-1 px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700">unpaid</span>
                      )}
                      {paymentDetail(s) && (
                        <div className="text-xs text-gray-400 mt-0.5">{paymentDetail(s)}</div>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <div className="inline-flex items-center gap-3">
                        <button
                          onClick={() => setPrintSale(s)}
                          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 text-sm"
                        >
                          <Truck size={14} /> Delivery Receipt
                        </button>
                        {canVoid && !s.is_voided && (
                          <button
                            onClick={() => setVoidFor(s)}
                            className="inline-flex items-center gap-1 text-red-600 hover:text-red-700 text-sm"
                          >
                            <Ban size={14} /> Void
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalPages > 1 && (
              <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                limit={PAGE_SIZE}
                onPageChange={setPage}
              />
            )}
          </>
        )}
      </Modal>

      {printSale && (
        <DeliveryReceiptModal
          sale={printSale}
          companyName={companyName}
          currency={currency}
          onClose={() => setPrintSale(null)}
        />
      )}

      {voidFor && (
        <VoidConfirmModal
          sale={voidFor}
          onCancel={() => setVoidFor(null)}
          onConfirmed={() => {
            setVoidFor(null);
            load();
          }}
        />
      )}
    </>
  );
}

function VoidConfirmModal({
  sale,
  onCancel,
  onConfirmed,
}: {
  sale: Sale;
  onCancel: () => void;
  onConfirmed: () => void;
}) {
  const supabase = createClient();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = text.trim().toUpperCase() === "VOID";

  const submit = async () => {
    if (!confirmed) return;
    setSaving(true);
    setError(null);
    const { error } = await supabase.rpc("void_sale", { p_sale: sale.id, p_reason: "Voided at POS" });
    if (error) {
      setError(error.message);
      setSaving(false);
    } else {
      onConfirmed();
    }
  };

  return (
    <Modal
      title="Void Sale"
      subtitle={sale.receipt_number}
      onClose={onCancel}
      maxWidth="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!confirmed || saving}
            className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold disabled:opacity-40"
          >
            {saving ? "Voiding…" : "Void Sale"}
          </button>
        </div>
      }
    >
      <div className="flex items-start gap-3 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
        <AlertTriangle size={18} className="mt-0.5 shrink-0" />
        <p>
          Voiding <span className="font-code font-medium">{sale.receipt_number}</span> restores its stock and cannot be
          undone.
        </p>
      </div>
      {error && <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <label className="block mt-4">
        <span className="block text-xs font-medium text-gray-500 mb-1">
          Type <span className="font-code font-semibold text-gray-700">VOID</span> to confirm
        </span>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          autoFocus
          placeholder="VOID"
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-red-500 outline-none"
        />
      </label>
    </Modal>
  );
}
