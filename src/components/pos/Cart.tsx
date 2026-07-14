"use client";

import { formatMoney } from "@/lib/config";
import type { CartItem } from "@/lib/types";
import { Minus, Plus, X, ShoppingCart } from "lucide-react";

interface Props {
  items: CartItem[];
  currency: string;
  subtotal: number;
  onUpdateItem: (index: number, updates: Partial<CartItem>) => void;
  onRemoveItem: (index: number) => void;
  onCheckout: () => void;
}

export function Cart({ items, currency, subtotal, onUpdateItem, onRemoveItem, onCheckout }: Props) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-4 border-b border-gray-200">
        <h2 className="font-semibold text-gray-800 flex items-center gap-2">
          <ShoppingCart size={18} /> Cart ({items.length} items)
        </h2>
      </div>

      <div className="flex-1 overflow-auto">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-300">
            <ShoppingCart size={48} />
            <p className="mt-3 text-sm text-gray-400">Cart is empty</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map((item, i) => (
              <div key={`${item.product_id}-${item.unit_name}`} className="px-5 py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900 truncate">{item.product_name}</div>
                  <div className="text-xs text-gray-400">
                    {item.unit_name} @ {formatMoney(item.price, currency)}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => onUpdateItem(i, { quantity: Math.max(1, item.quantity - 1) })}
                    className="p-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
                  >
                    <Minus size={14} />
                  </button>
                  <input
                    type="number"
                    min={1}
                    value={item.quantity}
                    onChange={(e) => onUpdateItem(i, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                    className="w-12 text-center border border-gray-200 rounded py-1 text-sm"
                  />
                  <button
                    onClick={() => onUpdateItem(i, { quantity: item.quantity + 1 })}
                    className="p-1 rounded border border-gray-200 text-gray-500 hover:bg-gray-50"
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <div className="w-24 text-right font-amount font-medium">
                  {formatMoney(item.total, currency)}
                </div>
                <button onClick={() => onRemoveItem(i)} className="p-1 text-gray-400 hover:text-red-500">
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-gray-200 p-5 bg-gray-50">
        <div className="flex items-center justify-between mb-3">
          <span className="text-gray-600">Total</span>
          <span className="text-2xl font-bold text-blue-700 font-amount">
            {formatMoney(subtotal, currency)}
          </span>
        </div>
        <button
          onClick={onCheckout}
          disabled={items.length === 0}
          className="w-full bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white py-3 rounded-lg font-semibold text-lg"
        >
          Checkout
        </button>
      </div>
    </div>
  );
}
