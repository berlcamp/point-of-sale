"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAdmin } from "@/components/admin/AdminProvider";
import { Modal } from "@/components/Modal";
import { formatMoney } from "@/lib/config";
import type { Product, StockBatch, InventoryMovement } from "@/lib/types";
import { Search, PackagePlus, SlidersHorizontal, Layers, History } from "lucide-react";

interface Row {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  low_stock: number;
}

const movementColor: Record<string, string> = {
  SALE: "bg-red-100 text-red-700",
  RESTOCK: "bg-green-100 text-green-700",
  ADJUSTMENT: "bg-amber-100 text-amber-700",
  RETURN: "bg-blue-100 text-blue-700",
};

export function InventoryManager() {
  const supabase = createClient();
  const { currency } = useAdmin();
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [receive, setReceive] = useState(false);
  const [adjust, setAdjust] = useState<Row | null>(null);
  const [batchesFor, setBatchesFor] = useState<Row | null>(null);
  const [movementsFor, setMovementsFor] = useState<Row | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("products")
      .select("id, name, sku, inventory(quantity, low_stock)")
      .eq("is_active", true)
      .order("name");
    if (search.trim()) {
      const s = `%${search.trim()}%`;
      q = q.or(`name.ilike.${s},sku.ilike.${s}`);
    }
    const { data } = await q;
    setRows(
      (data ?? []).map((p: {
        id: string;
        name: string;
        sku: string;
        inventory: { quantity: number; low_stock: number } | { quantity: number; low_stock: number }[] | null;
      }) => {
        const inv = Array.isArray(p.inventory) ? p.inventory[0] : p.inventory;
        return {
          id: p.id,
          name: p.name,
          sku: p.sku,
          quantity: Number(inv?.quantity ?? 0),
          low_stock: Number(inv?.low_stock ?? 0),
        };
      })
    );
    setLoading(false);
  }, [supabase, search]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
          <p className="text-gray-500 text-sm">Stock levels & movements</p>
        </div>
        <button
          onClick={() => setReceive(true)}
          className="flex items-center gap-2 bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <PackagePlus size={18} /> Receive Stock
        </button>
      </div>

      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search products…"
          className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        />
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-400">Loading…</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wide">
              <tr>
                <th className="text-left px-5 py-3">Product</th>
                <th className="text-left px-5 py-3">SKU</th>
                <th className="text-right px-5 py-3">Stock</th>
                <th className="text-right px-5 py-3">Min</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => {
                const low = r.quantity <= r.low_stock;
                return (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-5 py-3 font-medium text-gray-900">{r.name}</td>
                    <td className="px-5 py-3 font-code text-gray-500">{r.sku}</td>
                    <td className={`px-5 py-3 text-right font-semibold ${low ? "text-red-600" : "text-gray-800"}`}>
                      {r.quantity}
                    </td>
                    <td className="px-5 py-3 text-right text-gray-500">{r.low_stock}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                          low ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
                        }`}
                      >
                        {low ? "Low" : "OK"}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setAdjust(r)} className="p-2 text-gray-500 hover:text-amber-600 hover:bg-amber-50 rounded-lg" title="Adjust">
                          <SlidersHorizontal size={16} />
                        </button>
                        <button onClick={() => setBatchesFor(r)} className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="Batches">
                          <Layers size={16} />
                        </button>
                        <button onClick={() => setMovementsFor(r)} className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg" title="History">
                          <History size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {receive && (
        <ReceiveModal
          products={rows}
          onClose={() => setReceive(false)}
          onSaved={() => {
            setReceive(false);
            load();
          }}
        />
      )}
      {adjust && (
        <AdjustModal
          row={adjust}
          onClose={() => setAdjust(null)}
          onSaved={() => {
            setAdjust(null);
            load();
          }}
        />
      )}
      {batchesFor && (
        <BatchesModal row={batchesFor} currency={currency} onClose={() => setBatchesFor(null)} />
      )}
      {movementsFor && (
        <MovementsModal row={movementsFor} onClose={() => setMovementsFor(null)} />
      )}
    </div>
  );
}

function ReceiveModal({
  products,
  onClose,
  onSaved,
}: {
  products: Row[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [cost, setCost] = useState("");
  const [reason, setReason] = useState("Purchase");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const { error } = await supabase.rpc("receive_stock", {
      p_product: productId,
      p_quantity: Number(quantity) || 0,
      p_cost: Number(cost) || 0,
      p_reference: reference || null,
      p_reason: reason,
    });
    if (error) setError(error.message);
    else onSaved();
    setSaving(false);
  };

  return (
    <Modal
      title="Receive Stock"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100">Cancel</button>
          <button onClick={save} disabled={saving || !productId || !quantity} className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white disabled:opacity-50">
            {saving ? "Saving…" : "Receive"}
          </button>
        </div>
      }
    >
      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="space-y-4">
        <Field label="Product">
          <select className={inputCls} value={productId} onChange={(e) => setProductId(e.target.value)}>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Quantity (base units)">
            <input type="number" className={inputCls} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <Field label="Cost price / unit">
            <input type="number" className={inputCls} value={cost} onChange={(e) => setCost(e.target.value)} />
          </Field>
        </div>
        <Field label="Reason">
          <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option>Purchase</option>
            <option>Return</option>
            <option>Transfer In</option>
            <option>Correction</option>
          </select>
        </Field>
        <Field label="Reference / notes">
          <input className={inputCls} value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function AdjustModal({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: () => void }) {
  const supabase = createClient();
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("Correction");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    const { error } = await supabase.rpc("adjust_stock", {
      p_product: row.id,
      p_delta: -(Number(qty) || 0),
      p_reason: reason,
    });
    if (error) setError(error.message);
    else onSaved();
    setSaving(false);
  };

  return (
    <Modal
      title="Adjust / Remove Stock"
      subtitle={row.name}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100">Cancel</button>
          <button onClick={save} disabled={saving || !qty} className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50">
            {saving ? "Saving…" : "Remove"}
          </button>
        </div>
      }
    >
      {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <p className="text-sm text-gray-500 mb-4">Current stock: <b>{row.quantity}</b></p>
      <div className="space-y-4">
        <Field label="Quantity to remove (base units)">
          <input type="number" className={inputCls} value={qty} onChange={(e) => setQty(e.target.value)} />
        </Field>
        <Field label="Reason">
          <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
            <option>Correction</option>
            <option>Damaged</option>
            <option>Lost</option>
            <option>Transfer Out</option>
          </select>
        </Field>
      </div>
    </Modal>
  );
}

function BatchesModal({ row, currency, onClose }: { row: Row; currency: string; onClose: () => void }) {
  const supabase = createClient();
  const [batches, setBatches] = useState<StockBatch[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("stock_batches")
        .select("*")
        .eq("product_id", row.id)
        .order("received_at");
      setBatches((data as StockBatch[]) ?? []);
      setLoading(false);
    })();
  }, [supabase, row.id]);

  return (
    <Modal title="Stock Batches (FIFO)" subtitle={row.name} onClose={onClose} maxWidth="max-w-2xl">
      {loading ? (
        <div className="text-center text-gray-400 py-6">Loading…</div>
      ) : batches.length === 0 ? (
        <div className="text-center text-gray-400 py-6">No batches.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left py-2">Received</th>
              <th className="text-left py-2">Reference</th>
              <th className="text-right py-2">Initial</th>
              <th className="text-right py-2">Remaining</th>
              <th className="text-right py-2">Cost</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {batches.map((b) => (
              <tr key={b.id}>
                <td className="py-2">{new Date(b.received_at).toLocaleDateString()}</td>
                <td className="py-2 text-gray-500">{b.reference ?? "—"}</td>
                <td className="py-2 text-right">{b.initial_qty}</td>
                <td className="py-2 text-right font-semibold">{b.quantity}</td>
                <td className="py-2 text-right font-amount">{formatMoney(b.cost_price, currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

function MovementsModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const supabase = createClient();
  const [moves, setMoves] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("inventory_movements")
        .select("*")
        .eq("product_id", row.id)
        .order("created_at", { ascending: false })
        .limit(100);
      setMoves((data as InventoryMovement[]) ?? []);
      setLoading(false);
    })();
  }, [supabase, row.id]);

  return (
    <Modal title="Movement History" subtitle={row.name} onClose={onClose} maxWidth="max-w-2xl">
      {loading ? (
        <div className="text-center text-gray-400 py-6">Loading…</div>
      ) : moves.length === 0 ? (
        <div className="text-center text-gray-400 py-6">No movements.</div>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left py-2">Date</th>
              <th className="text-left py-2">Type</th>
              <th className="text-right py-2">Change</th>
              <th className="text-right py-2">Before</th>
              <th className="text-right py-2">After</th>
              <th className="text-left py-2 pl-3">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {moves.map((m) => (
              <tr key={m.id}>
                <td className="py-2 whitespace-nowrap">{new Date(m.created_at).toLocaleString()}</td>
                <td className="py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs ${movementColor[m.type]}`}>{m.type}</span>
                </td>
                <td className={`py-2 text-right font-semibold ${Number(m.quantity) < 0 ? "text-red-600" : "text-green-600"}`}>
                  {Number(m.quantity) > 0 ? "+" : ""}{m.quantity}
                </td>
                <td className="py-2 text-right text-gray-500">{m.previous_qty}</td>
                <td className="py-2 text-right text-gray-500">{m.new_qty}</td>
                <td className="py-2 pl-3 text-gray-500">{m.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

const inputCls =
  "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-gray-500 mb-1">{label}</span>
      {children}
    </label>
  );
}
