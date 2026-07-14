"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAdmin } from "@/components/admin/AdminProvider";
import { Modal } from "@/components/Modal";
import { Pagination } from "@/components/Pagination";
import { formatMoney } from "@/lib/config";
import type { Product, ProductUnit } from "@/lib/types";
import { Plus, Pencil, Trash2, Search, Package } from "lucide-react";

const LIMIT = 10;

interface UnitDraft {
  id?: string;
  unit_name: string;
  price: string;
  conversion_factor: string;
}

export function ProductsManager() {
  const supabase = createClient();
  const { companyId, currency } = useAdmin();
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("products")
      .select("*, units:product_units(*), inventory(quantity, low_stock)", {
        count: "exact",
      })
      .order("name")
      .range((page - 1) * LIMIT, page * LIMIT - 1);
    if (search.trim()) {
      const s = `%${search.trim()}%`;
      q = q.or(`name.ilike.${s},sku.ilike.${s},barcode.ilike.${s}`);
    }
    const { data, count } = await q;
    setProducts((data as Product[]) ?? []);
    setTotal(count ?? 0);
    setLoading(false);
  }, [supabase, page, search]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const remove = async (p: Product) => {
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
    await supabase.from("products").delete().eq("id", p.id);
    load();
  };

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Products</h1>
          <p className="text-gray-500 text-sm">Catalog & pricing</p>
        </div>
        <button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
          className="flex items-center gap-2 bg-blue-700 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium"
        >
          <Plus size={18} /> Add Product
        </button>
      </div>

      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
        <input
          value={search}
          onChange={(e) => {
            setPage(1);
            setSearch(e.target.value);
          }}
          placeholder="Search by name, SKU, or barcode…"
          className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
        />
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-400">Loading…</div>
        ) : products.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <Package className="mx-auto mb-3" size={40} /> No products found.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 uppercase text-xs tracking-wide">
              <tr>
                <th className="text-left px-5 py-3">Name</th>
                <th className="text-left px-5 py-3">SKU</th>
                <th className="text-left px-5 py-3">Units</th>
                <th className="text-right px-5 py-3">Base Price</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-right px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {products.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-medium text-gray-900">{p.name}</td>
                  <td className="px-5 py-3 font-code text-gray-500">{p.sku}</td>
                  <td className="px-5 py-3 text-gray-600">
                    {(p.units ?? []).map((u) => u.unit_name).join(", ") || "—"}
                  </td>
                  <td className="px-5 py-3 text-right font-amount">
                    {formatMoney(p.base_price, currency)}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                        p.is_active
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-200 text-gray-500"
                      }`}
                    >
                      {p.is_active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          setEditing(p);
                          setShowForm(true);
                        }}
                        className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => remove(p)}
                        className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!loading && total > LIMIT && (
          <Pagination
            page={page}
            totalPages={Math.ceil(total / LIMIT)}
            total={total}
            limit={LIMIT}
            onPageChange={setPage}
          />
        )}
      </div>

      {showForm && (
        <ProductForm
          product={editing}
          companyId={companyId}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function ProductForm({
  product,
  companyId,
  onClose,
  onSaved,
}: {
  product: Product | null;
  companyId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [name, setName] = useState(product?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [barcode, setBarcode] = useState(product?.barcode ?? "");
  const [basePrice, setBasePrice] = useState(String(product?.base_price ?? ""));
  const [isActive, setIsActive] = useState(product?.is_active ?? true);
  const [lowStock, setLowStock] = useState(
    String(product?.inventory?.low_stock ?? 10)
  );
  const [units, setUnits] = useState<UnitDraft[]>(
    (product?.units ?? []).length
      ? product!.units.map((u: ProductUnit) => ({
          id: u.id,
          unit_name: u.unit_name,
          price: String(u.price),
          conversion_factor: String(u.conversion_factor),
        }))
      : [{ unit_name: "piece", price: "", conversion_factor: "1" }]
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setUnit = (i: number, patch: Partial<UnitDraft>) =>
    setUnits((prev) => prev.map((u, idx) => (idx === i ? { ...u, ...patch } : u)));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        company_id: companyId,
        name,
        sku,
        barcode: barcode || null,
        base_price: Number(basePrice) || 0,
        is_active: isActive,
      };

      let productId = product?.id;
      if (product) {
        const { error } = await supabase.from("products").update(payload).eq("id", product.id);
        if (error) throw error;
        await supabase.from("product_units").delete().eq("product_id", product.id);
      } else {
        const { data, error } = await supabase.from("products").insert(payload).select().single();
        if (error) throw error;
        productId = data.id;
      }

      const unitRows = units
        .filter((u) => u.unit_name.trim())
        .map((u) => ({
          company_id: companyId,
          product_id: productId,
          unit_name: u.unit_name.trim(),
          price: Number(u.price) || 0,
          conversion_factor: Number(u.conversion_factor) || 1,
        }));
      if (unitRows.length) {
        const { error } = await supabase.from("product_units").insert(unitRows);
        if (error) throw error;
      }

      // Upsert inventory row (create for new product, update threshold otherwise).
      await supabase
        .from("inventory")
        .upsert(
          {
            company_id: companyId,
            product_id: productId,
            low_stock: Number(lowStock) || 0,
          },
          { onConflict: "product_id" }
        );

      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={product ? "Edit Product" : "Add Product"}
      onClose={onClose}
      maxWidth="max-w-2xl"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-gray-600 hover:bg-gray-100">
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !name.trim() || !sku.trim()}
            className="px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      }
    >
      {error && (
        <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <div className="space-y-4">
        <Field label="Product name">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label="SKU">
            <input className={inputCls} value={sku} onChange={(e) => setSku(e.target.value)} />
          </Field>
          <Field label="Barcode">
            <input className={inputCls} value={barcode ?? ""} onChange={(e) => setBarcode(e.target.value)} />
          </Field>
          <Field label="Base price">
            <input
              type="number"
              className={inputCls}
              value={basePrice}
              onChange={(e) => setBasePrice(e.target.value)}
            />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4 items-end">
          <Field label="Low-stock threshold">
            <input
              type="number"
              className={inputCls}
              value={lowStock}
              onChange={(e) => setLowStock(e.target.value)}
            />
          </Field>
          <label className="flex items-center gap-2 pb-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-sm text-gray-700">Active</span>
          </label>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-gray-500">Selling units</span>
            <button
              onClick={() =>
                setUnits((p) => [...p, { unit_name: "", price: "", conversion_factor: "1" }])
              }
              className="text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              + Add unit
            </button>
          </div>
          <div className="space-y-2">
            {units.map((u, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                <input
                  className={inputCls}
                  placeholder="Unit (e.g. piece)"
                  value={u.unit_name}
                  onChange={(e) => setUnit(i, { unit_name: e.target.value })}
                />
                <input
                  className={inputCls}
                  type="number"
                  placeholder="Price"
                  value={u.price}
                  onChange={(e) => setUnit(i, { price: e.target.value })}
                />
                <input
                  className={inputCls}
                  type="number"
                  placeholder="Base units"
                  title="How many base units this unit contains"
                  value={u.conversion_factor}
                  onChange={(e) => setUnit(i, { conversion_factor: e.target.value })}
                />
                <button
                  onClick={() => setUnits((p) => p.filter((_, idx) => idx !== i))}
                  disabled={units.length <= 1}
                  className="p-2 text-gray-400 hover:text-red-500 disabled:opacity-30"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
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
