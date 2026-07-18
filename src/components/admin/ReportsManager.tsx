"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAdmin } from "@/components/admin/AdminProvider";
import { Modal } from "@/components/Modal";
import { DeliveryReceiptModal } from "@/components/pos/DeliveryReceiptModal";
import { formatMoney, isUnsettledCollectible, paymentDetail } from "@/lib/config";
import type { Sale, SaleItem } from "@/lib/types";
import { Undo2, Truck } from "lucide-react";

type Tab = "sales" | "transactions" | "top" | "cashier" | "movements";

const TABS: { id: Tab; label: string }[] = [
  { id: "sales", label: "Sales" },
  { id: "transactions", label: "Transactions" },
  { id: "top", label: "Top Products" },
  { id: "cashier", label: "By Cashier" },
  { id: "movements", label: "Inventory Movements" },
];

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function ReportsManager() {
  const { currency, companyName } = useAdmin();
  const [tab, setTab] = useState<Tab>("sales");
  const today = new Date();
  const [from, setFrom] = useState(isoDay(today));
  const [to, setTo] = useState(isoDay(today));

  const preset = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    setFrom(isoDay(start));
    setTo(isoDay(end));
  };

  const range = {
    from: new Date(from + "T00:00:00").toISOString(),
    to: new Date(to + "T23:59:59.999").toISOString(),
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Reports</h1>

      <div className="flex flex-wrap items-end gap-3 mb-4 bg-white rounded-xl shadow-sm p-4">
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        </label>
        <div className="flex gap-1">
          {[{ l: "Today", d: 1 }, { l: "7d", d: 7 }, { l: "30d", d: 30 }, { l: "90d", d: 90 }].map((p) => (
            <button key={p.l} onClick={() => preset(p.d)} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">
              {p.l}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200 mb-4 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition ${
              tab === t.id ? "border-blue-600 text-blue-700" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "sales" && <SalesTab range={range} currency={currency} />}
      {tab === "transactions" && <TransactionsTab range={range} currency={currency} companyName={companyName} />}
      {tab === "top" && <TopTab range={range} currency={currency} />}
      {tab === "cashier" && <CashierTab range={range} currency={currency} />}
      {tab === "movements" && <MovementsTab range={range} />}
    </div>
  );
}

function SalesTab({ range, currency }: { range: { from: string; to: string }; currency: string }) {
  const supabase = createClient();
  const [s, setS] = useState<Record<string, number> | null>(null);
  useEffect(() => {
    supabase.rpc("report_summary", { p_from: range.from, p_to: range.to }).then(({ data }) => setS(data));
  }, [supabase, range.from, range.to]);
  if (!s) return <Loading />;
  const cards = [
    { label: "Revenue", value: formatMoney(s.revenue, currency) },
    { label: "COGS", value: formatMoney(s.cogs, currency) },
    { label: "Gross Profit", value: formatMoney(s.gross_profit, currency) },
    { label: "Margin", value: `${s.margin}%` },
    { label: "Discounts", value: formatMoney(s.discounts, currency) },
    { label: "Refunds", value: formatMoney(s.refunds, currency) },
    { label: "Transactions", value: String(s.transactions) },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((c) => (
        <div key={c.label} className="bg-white rounded-xl shadow-sm p-5">
          <div className="text-gray-500 text-sm">{c.label}</div>
          <div className="text-xl font-bold text-gray-900 font-amount mt-1">{c.value}</div>
        </div>
      ))}
    </div>
  );
}

type SaleWithCogs = Sale & { sale_items?: { cost_price: number; quantity: number }[] };

function saleCogs(s: SaleWithCogs) {
  return (s.sale_items ?? []).reduce((sum, it) => sum + Number(it.cost_price) * Number(it.quantity), 0);
}

function TransactionsTab({
  range,
  currency,
  companyName,
}: {
  range: { from: string; to: string };
  currency: string;
  companyName: string;
}) {
  const supabase = createClient();
  const [sales, setSales] = useState<SaleWithCogs[]>([]);
  const [loading, setLoading] = useState(true);
  const [receiptQ, setReceiptQ] = useState("");
  const [returnFor, setReturnFor] = useState<Sale | null>(null);
  const [printSale, setPrintSale] = useState<Sale | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("sales")
      .select("*, sale_items(cost_price, quantity)")
      .gte("created_at", range.from)
      .lte("created_at", range.to)
      .order("created_at", { ascending: false })
      .limit(200);
    if (receiptQ.trim()) {
      const term = receiptQ.trim();
      q = q.or(`receipt_number.ilike.%${term}%,customer_name.ilike.%${term}%`);
    }
    const { data } = await q;
    setSales((data as SaleWithCogs[]) ?? []);
    setLoading(false);
  }, [supabase, range.from, range.to, receiptQ]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div>
      <input
        value={receiptQ}
        onChange={(e) => setReceiptQ(e.target.value)}
        placeholder="Search receipt # or customer…"
        className="mb-3 border border-gray-300 rounded-lg px-3 py-2 text-sm w-64"
      />
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <Loading />
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
              <tr>
                <th className="text-left px-5 py-3">Receipt #</th>
                <th className="text-left px-5 py-3">Customer</th>
                <th className="text-left px-5 py-3">Date</th>
                <th className="text-left px-5 py-3">Payment</th>
                <th className="text-right px-5 py-3">COGS</th>
                <th className="text-right px-5 py-3">Total</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sales.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-code">{s.receipt_number}</td>
                  <td className="px-5 py-3 text-gray-700">{s.customer_name || <span className="text-gray-300">—</span>}</td>
                  <td className="px-5 py-3 text-gray-500">{new Date(s.created_at).toLocaleString()}</td>
                  <td className="px-5 py-3">
                    <span className="capitalize">{s.payment_method}</span>
                    {paymentDetail(s) && (
                      <div className="text-xs text-gray-400">{paymentDetail(s)}</div>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right font-amount text-gray-500">{formatMoney(saleCogs(s), currency)}</td>
                  <td className="px-5 py-3 text-right font-amount">{formatMoney(s.total, currency)}</td>
                  <td className="px-5 py-3">
                    {s.is_voided ? (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-700">VOIDED</span>
                    ) : isUnsettledCollectible(s) ? (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-amber-100 text-amber-700">UNPAID</span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">OK</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex items-center gap-3">
                      <button onClick={() => setPrintSale(s)} className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 text-sm">
                        <Truck size={14} /> Delivery Receipt
                      </button>
                      {!s.is_voided && (
                        <button onClick={() => setReturnFor(s)} className="inline-flex items-center gap-1 text-amber-600 hover:text-amber-700 text-sm">
                          <Undo2 size={14} /> Return
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {returnFor && (
        <ReturnModal
          sale={returnFor}
          currency={currency}
          onClose={() => setReturnFor(null)}
          onDone={() => {
            setReturnFor(null);
            load();
          }}
        />
      )}
      {printSale && (
        <DeliveryReceiptModal
          sale={printSale}
          companyName={companyName}
          currency={currency}
          onClose={() => setPrintSale(null)}
        />
      )}
    </div>
  );
}

function ReturnModal({ sale, currency, onClose, onDone }: { sale: Sale; currency: string; onClose: () => void; onDone: () => void }) {
  const supabase = createClient();
  const [items, setItems] = useState<SaleItem[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("sale_items").select("*").eq("sale_id", sale.id).then(({ data }) => setItems((data as SaleItem[]) ?? []));
  }, [supabase, sale.id]);

  const refund = items.reduce((sum, it) => sum + (qty[it.id] ?? 0) * Number(it.price), 0);

  const submit = async () => {
    setSaving(true);
    setError(null);
    const payload = items
      .filter((it) => (qty[it.id] ?? 0) > 0)
      .map((it) => ({ sale_item_id: it.id, quantity: qty[it.id] }));
    if (payload.length === 0) {
      setError("Select at least one item to return.");
      setSaving(false);
      return;
    }
    const { error } = await supabase.rpc("return_items", { p_sale: sale.id, p_items: payload, p_reason: reason });
    if (error) setError(error.message);
    else onDone();
    setSaving(false);
  };

  return (
    <Modal
      title="Return Items"
      subtitle={sale.receipt_number}
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-between">
          <span className="font-amount font-bold text-amber-700">Refund: {formatMoney(refund, currency)}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100">Cancel</button>
            <button onClick={submit} disabled={saving} className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50">
              {saving ? "Processing…" : "Process Return"}
            </button>
          </div>
        </div>
      }
    >
      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <table className="w-full text-sm">
        <thead className="text-gray-500 text-xs uppercase">
          <tr>
            <th className="text-left py-2">Item</th>
            <th className="text-right py-2">Sold</th>
            <th className="text-right py-2">Price</th>
            <th className="text-right py-2">Return Qty</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {items.map((it) => (
            <tr key={it.id}>
              <td className="py-2">{it.product_name} <span className="text-gray-400">/ {it.unit_name}</span></td>
              <td className="py-2 text-right">{it.quantity}</td>
              <td className="py-2 text-right font-amount">{formatMoney(it.price, currency)}</td>
              <td className="py-2 text-right">
                <input
                  type="number"
                  min={0}
                  max={it.quantity}
                  value={qty[it.id] ?? 0}
                  onChange={(e) =>
                    setQty((p) => ({ ...p, [it.id]: Math.min(Number(e.target.value) || 0, Number(it.quantity)) }))
                  }
                  className="w-20 border border-gray-300 rounded-lg px-2 py-1 text-right"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="block mt-4">
        <span className="block text-xs font-medium text-gray-500 mb-1">Reason</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
      </label>
    </Modal>
  );
}

function TopTab({ range, currency }: { range: { from: string; to: string }; currency: string }) {
  const supabase = createClient();
  const [rows, setRows] = useState<{ product_name: string; units: number; revenue: number; cost: number; profit: number }[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    supabase.rpc("report_top_products", { p_from: range.from, p_to: range.to, p_limit: 50 }).then(({ data }) => {
      setRows(data ?? []);
      setLoading(false);
    });
  }, [supabase, range.from, range.to]);
  if (loading) return <Loading />;
  return (
    <SimpleTable
      head={["Product", "Units", "Revenue", "Cost", "Profit", "Margin"]}
      align={["left", "right", "right", "right", "right", "right"]}
      rows={rows.map((r) => [
        r.product_name,
        String(r.units),
        formatMoney(r.revenue, currency),
        formatMoney(r.cost, currency),
        formatMoney(r.profit, currency),
        `${Number(r.revenue) > 0 ? Math.round((Number(r.profit) / Number(r.revenue)) * 100) : 0}%`,
      ])}
    />
  );
}

function CashierTab({ range, currency }: { range: { from: string; to: string }; currency: string }) {
  const supabase = createClient();
  const [rows, setRows] = useState<{ cashier: string; revenue: number; discount: number; txns: number; avg_sale: number }[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    supabase.rpc("report_by_cashier", { p_from: range.from, p_to: range.to }).then(({ data }) => {
      setRows(data ?? []);
      setLoading(false);
    });
  }, [supabase, range.from, range.to]);
  if (loading) return <Loading />;
  return (
    <SimpleTable
      head={["Cashier", "Transactions", "Revenue", "Discounts", "Avg Sale"]}
      align={["left", "right", "right", "right", "right"]}
      rows={rows.map((r) => [
        r.cashier,
        String(r.txns),
        formatMoney(r.revenue, currency),
        formatMoney(r.discount, currency),
        formatMoney(r.avg_sale, currency),
      ])}
    />
  );
}

function MovementsTab({ range }: { range: { from: string; to: string } }) {
  const supabase = createClient();
  const [rows, setRows] = useState<{ id: string; created_at: string; type: string; quantity: number; reason: string | null; user_name: string | null; product?: { name: string } }[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    supabase
      .from("inventory_movements")
      .select("id, created_at, type, quantity, reason, user_name, product:products(name)")
      .gte("created_at", range.from)
      .lte("created_at", range.to)
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }) => {
        setRows((data as never) ?? []);
        setLoading(false);
      });
  }, [supabase, range.from, range.to]);
  if (loading) return <Loading />;
  return (
    <SimpleTable
      head={["Date", "Product", "Type", "Change", "Reason", "User"]}
      align={["left", "left", "left", "right", "left", "left"]}
      rows={rows.map((m) => [
        new Date(m.created_at).toLocaleString(),
        m.product?.name ?? "—",
        m.type,
        `${Number(m.quantity) > 0 ? "+" : ""}${m.quantity}`,
        m.reason ?? "—",
        m.user_name ?? "—",
      ])}
    />
  );
}

function SimpleTable({ head, rows, align }: { head: string[]; rows: string[][]; align: ("left" | "right")[] }) {
  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      {rows.length === 0 ? (
        <div className="p-10 text-center text-gray-400">No data.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
            <tr>
              {head.map((h, i) => (
                <th key={h} className={`px-5 py-3 text-${align[i]}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50">
                {r.map((c, j) => (
                  <td key={j} className={`px-5 py-3 text-${align[j]} ${j === 0 ? "font-medium text-gray-900" : "text-gray-600"}`}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Loading() {
  return <div className="p-10 text-center text-gray-400">Loading…</div>;
}
