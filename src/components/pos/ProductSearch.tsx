"use client";

import { forwardRef, useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/config";
import type { Product } from "@/lib/types";
import { CheckCircle2, Plus, Search } from "lucide-react";

interface Props {
  products: Product[];
  currency: string;
  onAddToCart: (product: Product, unitName: string, quantity: number) => void;
}

export const ProductSearch = forwardRef<HTMLInputElement, Props>(
  function ProductSearch({ products, currency, onAddToCart }, ref) {
    const [query, setQuery] = useState("");
    const [justAdded, setJustAdded] = useState<string | null>(null);

    const hasQuery = query.trim().length > 0;

    useEffect(() => {
      if (!justAdded) return;
      const t = setTimeout(() => setJustAdded(null), 2500);
      return () => clearTimeout(t);
    }, [justAdded]);

    const filtered = useMemo(() => {
      const q = query.trim().toLowerCase();
      // Show nothing until the cashier searches — full catalogs are too big
      // to browse at the register.
      if (!q) return [];
      return products
        .filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.sku.toLowerCase().includes(q) ||
            (p.barcode ?? "").toLowerCase().includes(q)
        )
        .slice(0, 50);
    }, [products, query]);

    // Scanner flow: scanners "type" the code and send Enter. On Enter, add
    // an exact barcode/SKU match (or a lone result) straight to the cart
    // and clear the box for the next scan.
    const addExactMatch = () => {
      const q = query.trim().toLowerCase();
      if (!q) return;
      const match =
        products.find((p) => (p.barcode ?? "").toLowerCase() === q) ??
        products.find((p) => p.sku.toLowerCase() === q) ??
        (filtered.length === 1 ? filtered[0] : undefined);
      const unitName = match?.units?.[0]?.unit_name;
      if (!match || !unitName) return;
      onAddToCart(match, unitName, 1);
      setQuery("");
      setJustAdded(match.name);
    };

    return (
      <div className="flex flex-col h-full">
        <div className="p-4 border-b border-gray-200">
          <div className="relative">
            <Search className="absolute left-3 top-3 text-gray-400" size={18} />
            <input
              ref={ref}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addExactMatch();
                }
              }}
              placeholder="Search products by name, SKU, or barcode…"
              className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          {justAdded && (
            <div className="mt-2 flex items-center gap-1.5 text-sm text-green-700">
              <CheckCircle2 size={15} />
              <span className="truncate">Added “{justAdded}” to cart</span>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-auto">
          {!hasQuery ? (
            <div className="flex flex-col items-center justify-center text-center py-16">
              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
                <Search className="text-gray-400" size={22} />
              </div>
              <p className="text-gray-500 font-medium">Search for a product above</p>
              <p className="text-gray-400 text-sm mt-1">
                Type a name or SKU, or scan a barcode to get started.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center text-gray-400 py-10">No products found.</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filtered.map((p) => (
                <ProductRow key={p.id} product={p} currency={currency} onAdd={onAddToCart} />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
);

function ProductRow({
  product,
  currency,
  onAdd,
}: {
  product: Product;
  currency: string;
  onAdd: (p: Product, unit: string, qty: number) => void;
}) {
  const units = product.units ?? [];
  const [unitName, setUnitName] = useState(units[0]?.unit_name ?? "");
  const [qty, setQty] = useState(1);

  const stock = Number(product.inventory?.quantity ?? 0);
  const low = stock <= Number(product.inventory?.low_stock ?? 0);

  return (
    <div className="px-4 py-2 flex items-center justify-between gap-4 hover:bg-gray-50 transition">
      <div className="min-w-0">
        <div className="font-medium text-gray-900 truncate">{product.name}</div>
        <div className="text-xs text-gray-400 font-code">
          {product.sku}
          {product.barcode ? ` · ${product.barcode}` : ""}
          <span className={`ml-2 font-medium ${low ? "text-red-600" : "text-green-600"}`}>
            {stock} in stock
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {units.length > 1 && (
          <select
            value={unitName}
            onChange={(e) => setUnitName(e.target.value)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm max-w-[130px]"
          >
            {units.map((u) => (
              <option key={u.id} value={u.unit_name}>
                {u.unit_name} — {formatMoney(u.price, currency)}
              </option>
            ))}
          </select>
        )}
        <input
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))}
          className="w-16 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-center"
        />
        <button
          onClick={() => unitName && onAdd(product, unitName, qty)}
          disabled={!unitName}
          className="flex items-center gap-1 bg-blue-700 hover:bg-blue-600 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg text-sm font-medium"
        >
          <Plus size={16} /> Add
        </button>
      </div>
    </div>
  );
}
