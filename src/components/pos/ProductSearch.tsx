"use client";

import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { formatMoney } from "@/lib/config";
import type { Product } from "@/lib/types";
import { CheckCircle2, Plus, Search } from "lucide-react";

interface Props {
  products: Product[];
  currency: string;
  onAddToCart: (product: Product, unitName: string, quantity: number) => void;
}

type Selection = { unitName: string; qty: number };

const defaultSelection = (p: Product): Selection => ({
  unitName: p.units?.[0]?.unit_name ?? "",
  qty: 1,
});

export const ProductSearch = forwardRef<HTMLInputElement, Props>(
  function ProductSearch({ products, currency, onAddToCart }, ref) {
    const [query, setQuery] = useState("");
    const [justAdded, setJustAdded] = useState<string | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [selections, setSelections] = useState<Record<string, Selection>>({});
    const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

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

    // Reset the highlight to the top whenever the result set changes.
    useEffect(() => {
      setActiveIndex(0);
    }, [query]);

    // Keep the highlighted row visible as the cashier arrows through results.
    useEffect(() => {
      rowRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
    }, [activeIndex, filtered.length]);

    const getSel = (p: Product): Selection => selections[p.id] ?? defaultSelection(p);
    const patchSel = (p: Product, patch: Partial<Selection>) =>
      setSelections((s) => ({ ...s, [p.id]: { ...(s[p.id] ?? defaultSelection(p)), ...patch } }));

    // Enter adds to the cart: an exact barcode/SKU match wins (scanner flow),
    // otherwise the currently highlighted row is added with its chosen qty.
    const handleEnter = () => {
      const q = query.trim().toLowerCase();
      const exact = q
        ? products.find((p) => (p.barcode ?? "").toLowerCase() === q) ??
          products.find((p) => p.sku.toLowerCase() === q)
        : undefined;
      const target = exact ?? filtered[activeIndex];
      if (!target) return;
      const sel = getSel(target);
      const unitName = sel.unitName || target.units?.[0]?.unit_name;
      if (!unitName) return;
      onAddToCart(target, unitName, exact ? 1 : sel.qty);
      setQuery("");
      setJustAdded(target.name);
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleEnter();
        return;
      }
      if (filtered.length === 0) return;
      const active = filtered[activeIndex];
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "ArrowRight" && active) {
        e.preventDefault();
        patchSel(active, { qty: getSel(active).qty + 1 });
      } else if (e.key === "ArrowLeft" && active) {
        e.preventDefault();
        patchSel(active, { qty: Math.max(1, getSel(active).qty - 1) });
      }
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
              onKeyDown={onKeyDown}
              placeholder="Search products by name, SKU, or barcode…"
              className="w-full pl-10 pr-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
          {hasQuery && filtered.length > 0 && (
            <div className="mt-2 text-xs text-gray-400">
              ↑↓ to select · ←→ to set quantity · Enter to add
            </div>
          )}
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
              {filtered.map((p, i) => (
                <ProductRow
                  key={p.id}
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  product={p}
                  currency={currency}
                  active={i === activeIndex}
                  selection={getSel(p)}
                  onUnitChange={(unitName) => patchSel(p, { unitName })}
                  onQtyChange={(qty) => patchSel(p, { qty })}
                  onAdd={onAddToCart}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }
);

const ProductRow = forwardRef<
  HTMLDivElement,
  {
    product: Product;
    currency: string;
    active: boolean;
    selection: Selection;
    onUnitChange: (unitName: string) => void;
    onQtyChange: (qty: number) => void;
    onAdd: (p: Product, unit: string, qty: number) => void;
  }
>(function ProductRow(
  { product, currency, active, selection, onUnitChange, onQtyChange, onAdd },
  ref
) {
  const units = product.units ?? [];
  const { unitName, qty } = selection;

  const stock = Number(product.inventory?.quantity ?? 0);
  const low = stock <= Number(product.inventory?.low_stock ?? 0);

  return (
    <div
      ref={ref}
      className={`px-4 py-2 flex items-center justify-between gap-4 transition ${
        active ? "bg-blue-50 ring-1 ring-inset ring-blue-200" : "hover:bg-gray-50"
      }`}
    >
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
            onChange={(e) => onUnitChange(e.target.value)}
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
          onChange={(e) => onQtyChange(Math.max(1, Number(e.target.value) || 1))}
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
});
