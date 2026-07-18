"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAdmin } from "@/components/admin/AdminProvider";
import { Modal } from "@/components/Modal";
import { collectibleDueDate, formatMoney, paymentDetail } from "@/lib/config";
import type { Sale } from "@/lib/types";
import { CheckCircle2, HandCoins, Search } from "lucide-react";

type StatusFilter = "outstanding" | "settled" | "all";

const methodPill: Record<string, string> = {
  cheque: "bg-violet-100 text-violet-700",
  terms: "bg-amber-100 text-amber-700",
};

export function CollectiblesManager() {
  const supabase = createClient();
  const { currency } = useAdmin();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StatusFilter>("outstanding");
  const [search, setSearch] = useState("");
  const [settleFor, setSettleFor] = useState<Sale | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("sales")
      .select("*")
      .in("payment_method", ["cheque", "terms"])
      .eq("is_voided", false)
      .order("created_at", { ascending: true })
      .limit(500);
    if (status === "outstanding") q = q.is("settled_at", null);
    if (status === "settled") q = q.not("settled_at", "is", null);
    const term = search.trim();
    if (term) q = q.or(`receipt_number.ilike.%${term}%,customer_name.ilike.%${term}%`);
    const { data } = await q;
    setSales((data as Sale[]) ?? []);
    setLoading(false);
  }, [supabase, status, search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const outstanding = sales.filter((s) => !s.settled_at);
  const now = new Date();
  const overdue = outstanding.filter((s) => {
    const due = collectibleDueDate(s);
    return due !== null && due < now;
  });
  const sum = (list: Sale[]) => list.reduce((t, s) => t + Number(s.total), 0);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Collectibles</h1>
      <p className="text-sm text-gray-500 mb-4">
        Cheque and terms sales awaiting payment. Mark them paid once the cheque
        clears or the balance is collected.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
        <SummaryCard label="Outstanding" value={formatMoney(sum(outstanding), currency)} sub={`${outstanding.length} sale${outstanding.length === 1 ? "" : "s"}`} />
        <SummaryCard label="Overdue" value={formatMoney(sum(overdue), currency)} sub={`${overdue.length} sale${overdue.length === 1 ? "" : "s"}`} accent={overdue.length > 0 ? "text-red-600" : undefined} />
        <SummaryCard
          label="Cheques on hand"
          value={formatMoney(sum(outstanding.filter((s) => s.payment_method === "cheque")), currency)}
          sub={`${outstanding.filter((s) => s.payment_method === "cheque").length} cheque(s)`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3">
        <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm">
          {(
            [
              { id: "outstanding", label: "Outstanding" },
              { id: "settled", label: "Paid" },
              { id: "all", label: "All" },
            ] as { id: StatusFilter; label: string }[]
          ).map((f) => (
            <button
              key={f.id}
              onClick={() => setStatus(f.id)}
              className={`px-4 py-2 font-medium transition ${
                status === f.id ? "bg-blue-700 text-white" : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search receipt # or customer…"
            className="border border-gray-300 rounded-lg pl-8 pr-3 py-2 text-sm w-64 focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-400">Loading…</div>
        ) : sales.length === 0 ? (
          <div className="p-10 text-center text-gray-400">
            {status === "outstanding" ? "Nothing to collect — all caught up." : "No collectibles found."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
              <tr>
                <th className="text-left px-5 py-3">Receipt #</th>
                <th className="text-left px-5 py-3">Customer</th>
                <th className="text-left px-5 py-3">Sale Date</th>
                <th className="text-left px-5 py-3">Method</th>
                <th className="text-left px-5 py-3">Due</th>
                <th className="text-right px-5 py-3">Amount</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sales.map((s) => {
                const due = collectibleDueDate(s);
                const isOverdue = !s.settled_at && due !== null && due < now;
                return (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-code">{s.receipt_number}</td>
                    <td className="px-5 py-3 text-gray-700">{s.customer_name || <span className="text-gray-300">—</span>}</td>
                    <td className="px-5 py-3 text-gray-500">{new Date(s.created_at).toLocaleDateString()}</td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs capitalize ${methodPill[s.payment_method] ?? "bg-gray-100"}`}>
                        {s.payment_method}
                      </span>
                      {paymentDetail(s) && <div className="text-xs text-gray-400 mt-0.5">{paymentDetail(s)}</div>}
                    </td>
                    <td className={`px-5 py-3 ${isOverdue ? "text-red-600 font-medium" : "text-gray-500"}`}>
                      {due ? due.toLocaleDateString() : "—"}
                      {isOverdue && <div className="text-xs">overdue</div>}
                    </td>
                    <td className="px-5 py-3 text-right font-amount">{formatMoney(s.total, currency)}</td>
                    <td className="px-5 py-3">
                      {s.settled_at ? (
                        <div>
                          <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">PAID</span>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {new Date(s.settled_at).toLocaleDateString()}
                            {s.settled_by_name ? ` · ${s.settled_by_name}` : ""}
                          </div>
                        </div>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700">UNPAID</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {!s.settled_at && (
                        <button
                          onClick={() => setSettleFor(s)}
                          className="inline-flex items-center gap-1 text-green-700 hover:text-green-800 text-sm font-medium"
                        >
                          <HandCoins size={14} /> Mark as Paid
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {settleFor && (
        <SettleConfirmModal
          sale={settleFor}
          currency={currency}
          onCancel={() => setSettleFor(null)}
          onConfirmed={() => {
            setSettleFor(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function SummaryCard({ label, value, sub, accent }: { label: string; value: string; sub: string; accent?: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-5">
      <div className="text-gray-500 text-sm">{label}</div>
      <div className={`text-xl font-bold font-amount mt-1 ${accent ?? "text-gray-900"}`}>{value}</div>
      <div className="text-xs text-gray-400 mt-0.5">{sub}</div>
    </div>
  );
}

function SettleConfirmModal({
  sale,
  currency,
  onCancel,
  onConfirmed,
}: {
  sale: Sale;
  currency: string;
  onCancel: () => void;
  onConfirmed: () => void;
}) {
  const supabase = createClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    const { error } = await supabase.rpc("settle_sale", { p_sale: sale.id });
    if (error) {
      setError(error.message);
      setSaving(false);
    } else {
      onConfirmed();
    }
  };

  return (
    <Modal
      title="Mark as Paid"
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
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white font-semibold disabled:opacity-40"
          >
            {saving ? "Saving…" : "Mark as Paid"}
          </button>
        </div>
      }
    >
      <div className="flex items-start gap-3 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800">
        <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
        <p>
          Confirm that <span className="font-amount font-semibold">{formatMoney(sale.total, currency)}</span> from{" "}
          <span className="font-medium">{sale.customer_name || "walk-in customer"}</span> has been collected
          {sale.payment_method === "cheque" ? " (cheque cleared)" : ""}.
        </p>
      </div>
      {error && (
        <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
      )}
    </Modal>
  );
}
