"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { SignOutButton } from "@/components/SignOutButton";
import { ProductSearch } from "@/components/pos/ProductSearch";
import { Cart } from "@/components/pos/Cart";
import { CheckoutModal, type CheckoutDetails } from "@/components/pos/CheckoutModal";
import { ReceiptModal, type ReceiptData } from "@/components/pos/ReceiptModal";
import { SalesHistory } from "@/components/pos/SalesHistory";
import {
  cacheProducts,
  getCachedProducts,
  enqueueSale,
  flushOutbox,
  pendingCount,
  isOnline,
} from "@/lib/offline/sync";
import { PinManager } from "@/components/pos/PinManager";
import { ShortcutsModal } from "@/components/pos/ShortcutsModal";
import { PrinterSettingsModal } from "@/components/pos/PrinterSettingsModal";
import { applyReceiptWidth, loadPrinterSettings } from "@/lib/printer/settings";
import { reconnectThermalPrinter } from "@/lib/printer/thermal";
import { hasPin } from "@/lib/auth/local";
import { DEFAULT_TERMINAL_ID, formatMoney } from "@/lib/config";
import type { CartItem, Product, CreateSalePayload, Role } from "@/lib/types";
import { Wifi, WifiOff, RefreshCw, Lock, KeyRound, Keyboard, Printer, X } from "lucide-react";

interface Props {
  companyId: string;
  companyName: string;
  currency: string;
  userId: string;
  userName: string;
  role: Role;
  onLock?: () => void;
}

function makeReceiptNumber() {
  const d = new Date();
  const stamp =
    d.getFullYear().toString() +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0") +
    String(d.getHours()).padStart(2, "0") +
    String(d.getMinutes()).padStart(2, "0") +
    String(d.getSeconds()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 900 + 100);
  return `${DEFAULT_TERMINAL_ID}-${stamp}-${rand}`;
}

export function POSClient({ companyId, companyName, currency, userName, role, onLock }: Props) {
  const supabase = createClient();
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [showCheckout, setShowCheckout] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [summary, setSummary] = useState({ revenue: 0, transactions: 0 });
  const [pinEnabled, setPinEnabled] = useState(false);
  const [showPinManager, setShowPinManager] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showPrinterSettings, setShowPrinterSettings] = useState(false);
  const [pinNudgeDismissed, setPinNudgeDismissed] = useState(
    () =>
      typeof window !== "undefined" &&
      localStorage.getItem("pos-pin-nudge-dismissed") === "1"
  );
  const searchRef = useRef<HTMLInputElement>(null);

  const dismissPinNudge = () => {
    localStorage.setItem("pos-pin-nudge-dismissed", "1");
    setPinNudgeDismissed(true);
  };

  const canVoid = role === "admin" || role === "manager";

  const loadProducts = useCallback(async () => {
    if (isOnline()) {
      const { data } = await supabase
        .from("products")
        .select("*, units:product_units(*), inventory(quantity, low_stock)")
        .eq("is_active", true)
        .order("name");
      const list = (data as Product[]) ?? [];
      setProducts(list);
      cacheProducts(companyId, list);
    } else {
      setProducts(await getCachedProducts(companyId));
    }
  }, [supabase, companyId]);

  const loadSummary = useCallback(async () => {
    if (!isOnline()) return;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const { data } = await supabase.rpc("report_summary", {
      p_from: start.toISOString(),
      p_to: end.toISOString(),
    });
    if (data) setSummary({ revenue: Number(data.revenue), transactions: Number(data.transactions) });
  }, [supabase]);

  const refreshPending = useCallback(async () => setPending(await pendingCount()), []);

  const sync = useCallback(async () => {
    if (!isOnline()) return;
    const n = await flushOutbox(supabase);
    await refreshPending();
    if (n > 0) {
      await loadProducts();
      await loadSummary();
    }
  }, [supabase, refreshPending, loadProducts, loadSummary]);

  useEffect(() => {
    setOnline(isOnline());
    loadProducts();
    loadSummary();
    refreshPending();
    hasPin().then(setPinEnabled);
    searchRef.current?.focus();
    // Reach the paired thermal printer (if any) so the first receipt prints
    // without a pairing dialog, and size the browser-print fallback to the roll.
    const printerSettings = loadPrinterSettings();
    applyReceiptWidth(printerSettings);
    reconnectThermalPrinter(printerSettings).catch(() => {});
  }, [loadProducts, loadSummary, refreshPending]);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      sync();
      loadProducts();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    const interval = setInterval(sync, 30000);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      clearInterval(interval);
    };
  }, [sync, loadProducts]);

  // Global POS shortcuts. Keep in sync with POS_SHORTCUTS in ShortcutsModal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F1") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === "F4") {
        e.preventDefault();
        if (cart.length > 0 && !showCheckout) setShowCheckout(true);
      } else if (e.key === "?") {
        // Ignore while typing in a field so "?" stays a literal character.
        const t = e.target as HTMLElement | null;
        const tag = t?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
        e.preventDefault();
        setShowShortcuts((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cart.length, showCheckout]);

  const addToCart = (product: Product, unitName: string, quantity: number) => {
    const unit = (product.units ?? []).find((u) => u.unit_name === unitName);
    if (!unit) return;
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.product_id === product.id && i.unit_name === unitName);
      if (idx >= 0) {
        return prev.map((i, x) =>
          x === idx
            ? { ...i, quantity: i.quantity + quantity, total: (i.quantity + quantity) * i.price - i.discount }
            : i
        );
      }
      return [
        ...prev,
        {
          product_id: product.id,
          product_name: product.name,
          unit_name: unitName,
          quantity,
          price: Number(unit.price),
          cost_price: 0,
          discount: 0,
          total: quantity * Number(unit.price),
          max_stock: Number(product.inventory?.quantity ?? 9999),
          conversion_factor: Number(unit.conversion_factor),
        },
      ];
    });
  };

  const updateCartItem = (index: number, updates: Partial<CartItem>) =>
    setCart((prev) =>
      prev.map((item, i) => {
        if (i !== index) return item;
        const u = { ...item, ...updates };
        u.total = u.quantity * u.price - u.discount;
        return u;
      })
    );

  const removeCartItem = (index: number) => setCart((prev) => prev.filter((_, i) => i !== index));

  const subtotal = cart.reduce((s, i) => s + i.total, 0);

  const handleCheckout = async ({
    amountPaid,
    discount,
    method,
    customerName,
    chequeDate,
    paymentTerms,
  }: CheckoutDetails) => {
    const id = crypto.randomUUID();
    const receiptNumber = makeReceiptNumber();
    const createdAt = new Date().toISOString();
    const total = Math.max(0, subtotal - discount);
    const customer = customerName.trim() || undefined;

    const payload: CreateSalePayload = {
      id,
      receipt_number: receiptNumber,
      customer_name: customer,
      discount,
      amount_paid: amountPaid,
      payment_method: method,
      cheque_date: chequeDate,
      payment_terms: paymentTerms,
      terminal_id: DEFAULT_TERMINAL_ID,
      created_at: createdAt,
      items: cart.map((i) => ({
        product_id: i.product_id,
        product_name: i.product_name,
        unit_name: i.unit_name,
        quantity: i.quantity,
        price: i.price,
        discount: i.discount,
      })),
    };

    // Nothing is tendered on a terms sale, so no change is due.
    const change = method === "terms" ? 0 : amountPaid - total;

    const receiptData: ReceiptData = {
      receipt_number: receiptNumber,
      customer_name: customer,
      created_at: createdAt,
      subtotal,
      discount,
      total,
      amount_paid: amountPaid,
      change,
      payment_method: method,
      cheque_date: chequeDate,
      payment_terms: paymentTerms,
      cashier_name: userName,
      items: cart.map((i) => ({
        product_name: i.product_name,
        unit_name: i.unit_name,
        quantity: i.quantity,
        price: i.price,
        total: i.total,
      })),
    };

    let queued = false;
    if (isOnline()) {
      const { error } = await supabase.rpc("create_sale", { payload });
      if (error) queued = true; // fall back to outbox on failure
    } else {
      queued = true;
    }

    if (queued) {
      await enqueueSale({
        id,
        payload,
        receipt: {
          receipt_number: receiptNumber,
          customer_name: customer,
          total,
          subtotal,
          discount,
          amount_paid: amountPaid,
          change,
          payment_method: method,
          cheque_date: chequeDate,
          payment_terms: paymentTerms,
          created_at: createdAt,
          cashier_name: userName,
          items: receiptData.items,
        },
        created_at: createdAt,
        synced: 0,
        attempts: 0,
      });
      receiptData.offline = true;
      await refreshPending();
    }

    // Optimistically decrement local stock.
    setProducts((prev) =>
      prev.map((p) => {
        const line = cart.find((c) => c.product_id === p.id);
        if (!line || !p.inventory) return p;
        return {
          ...p,
          inventory: {
            ...p.inventory,
            quantity: Number(p.inventory.quantity) - line.quantity * line.conversion_factor,
          },
        };
      })
    );

    setReceipt(receiptData);
    setCart([]);
    setShowCheckout(false);
    if (!queued) loadSummary();
    searchRef.current?.focus();
  };

  return (
    <div className="h-screen flex flex-col">
      <header className="bg-blue-700 text-white px-6 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">{companyName}</h1>
          <span className="text-blue-200 text-sm">POS Terminal</span>
          <span
            className={`ml-2 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
              online ? "bg-blue-600 text-blue-100" : "bg-amber-500 text-white"
            }`}
          >
            {online ? <Wifi size={12} /> : <WifiOff size={12} />}
            {online ? "Online" : "Offline"}
          </span>
          {pending > 0 && (
            <button
              onClick={sync}
              className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-white/15 hover:bg-white/25"
              title="Sync pending sales"
            >
              <RefreshCw size={12} /> {pending} pending
            </button>
          )}
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right text-sm">
            <div className="text-blue-200">Today&apos;s Sales</div>
            <div className="font-bold font-amount">
              {summary.transactions} txns · {formatMoney(summary.revenue, currency)}
            </div>
          </div>
          <button
            onClick={() => setShowHistory(true)}
            className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded text-sm"
          >
            Today Sales
          </button>
          {(role === "admin" || role === "manager") && (
            <Link href="/admin" className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded text-sm">
              Admin
            </Link>
          )}
          <button
            onClick={() => setShowShortcuts(true)}
            className="bg-blue-600 hover:bg-blue-500 p-2 rounded"
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
          >
            <Keyboard size={16} />
          </button>
          <button
            onClick={() => setShowPrinterSettings(true)}
            className="bg-blue-600 hover:bg-blue-500 p-2 rounded"
            title="Receipt printer settings"
            aria-label="Receipt printer settings"
          >
            <Printer size={16} />
          </button>
          <button
            onClick={() => setShowPinManager(true)}
            className="bg-blue-600 hover:bg-blue-500 p-2 rounded"
            title={pinEnabled ? "Change terminal PIN" : "Set a terminal PIN"}
            aria-label="Terminal PIN settings"
          >
            <KeyRound size={16} />
          </button>
          {pinEnabled && onLock && (
            <button
              onClick={onLock}
              className="bg-blue-600 hover:bg-blue-500 p-2 rounded"
              title="Lock terminal"
              aria-label="Lock terminal"
            >
              <Lock size={16} />
            </button>
          )}
          <SignOutButton />
        </div>
      </header>

      {!pinEnabled && !pinNudgeDismissed && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-amber-800">
            <KeyRound size={15} />
            <span>
              Set a terminal PIN to unlock this device offline without signing
              in again.
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowPinManager(true)}
              className="font-medium text-amber-900 underline hover:text-amber-950"
            >
              Set PIN
            </button>
            <button
              onClick={dismissPinNudge}
              className="text-amber-500 hover:text-amber-700"
              aria-label="Dismiss"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="w-1/2 border-r border-gray-200 flex flex-col bg-gray-50">
          <ProductSearch ref={searchRef} products={products} currency={currency} onAddToCart={addToCart} />
        </div>
        <div className="w-1/2 flex flex-col bg-white">
          <Cart
            items={cart}
            currency={currency}
            subtotal={subtotal}
            onUpdateItem={updateCartItem}
            onRemoveItem={removeCartItem}
            onCheckout={() => setShowCheckout(true)}
          />
        </div>
      </div>

      {showCheckout && (
        <CheckoutModal
          subtotal={subtotal}
          itemCount={cart.length}
          currency={currency}
          onConfirm={handleCheckout}
          onClose={() => setShowCheckout(false)}
        />
      )}

      {receipt && (
        <ReceiptModal
          receipt={receipt}
          companyName={companyName}
          currency={currency}
          onNewTransaction={() => setReceipt(null)}
        />
      )}

      {showHistory && (
        <SalesHistory
          companyName={companyName}
          currency={currency}
          canVoid={canVoid}
          onClose={() => setShowHistory(false)}
        />
      )}

      {showPinManager && (
        <PinManager
          onClose={() => setShowPinManager(false)}
          onChanged={setPinEnabled}
        />
      )}

      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}

      {showPrinterSettings && (
        <PrinterSettingsModal
          companyName={companyName}
          onClose={() => setShowPrinterSettings(false)}
        />
      )}
    </div>
  );
}
