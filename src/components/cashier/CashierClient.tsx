"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { SignOutButton } from "@/components/SignOutButton";
import { CompanySwitcher } from "@/components/CompanySwitcher";
import { useSwitchGate } from "@/lib/offline/switch-gate";
import { PaymentModal } from "@/components/cashier/PaymentModal";
import { CancelTicketModal } from "@/components/cashier/CancelTicketModal";
import { ReceiptModal, type ReceiptData } from "@/components/pos/ReceiptModal";
import { PrinterSettingsModal } from "@/components/pos/PrinterSettingsModal";
import { applyReceiptWidth, loadPrinterSettings } from "@/lib/printer/settings";
import { reconnectThermalPrinter } from "@/lib/printer/thermal";
import { formatMoney, paymentDetail } from "@/lib/config";
import type { Membership, Role, Sale, SaleItem, TransactionFlow } from "@/lib/types";
import {
  Banknote,
  LayoutDashboard,
  Printer,
  RefreshCw,
  Search,
  Store,
  Ticket,
  X,
} from "lucide-react";

type Tab = "pending" | "completed";

// The booth's queue is shared state written by other terminals, so it is
// re-read on a timer rather than waiting for the cashier to refresh.
const POLL_MS = 8000;

type SaleWithItems = Sale & { sale_items: SaleItem[] };

export function CashierClient({
  companyName,
  currency,
  transactionFlow,
  userName,
  role,
  activeCompanyId,
  memberships,
}: {
  companyName: string;
  currency: string;
  transactionFlow: TransactionFlow;
  userName: string;
  role: Role;
  activeCompanyId: string;
  memberships: Membership[];
}) {
  const supabase = createClient();
  const gate = useSwitchGate();
  const [tab, setTab] = useState<Tab>("pending");
  const [sales, setSales] = useState<SaleWithItems[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [payFor, setPayFor] = useState<SaleWithItems | null>(null);
  const [cancelFor, setCancelFor] = useState<SaleWithItems | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [showPrinterSettings, setShowPrinterSettings] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const isBoothStore = transactionFlow === "cashier_booth";
  const canLeaveBooth = role === "admin" || role === "manager";

  const load = useCallback(async () => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    let q = supabase
      .from("sales")
      .select("*, sale_items(*)")
      .eq("is_voided", false)
      .eq("status", tab === "pending" ? "pending" : "completed")
      .order("created_at", { ascending: tab === "pending" })
      .limit(100);

    // Pending tickets are all live work; completed ones are only listed so the
    // cashier can reprint a receipt from today.
    if (tab === "completed") q = q.gte("created_at", startOfDay.toISOString());

    const term = search.trim();
    if (term) {
      const filters = [`receipt_number.ilike.%${term}%`, `customer_name.ilike.%${term}%`];
      // A bare number is almost always the ticket the customer is holding.
      if (/^\d+$/.test(term)) filters.push(`ticket_number.eq.${Number(term)}`);
      q = q.or(filters.join(","));
    }

    const { data } = await q;
    setSales((data as SaleWithItems[]) ?? []);
    setLoading(false);
  }, [supabase, tab, search]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  // Keep the queue current while the cashier is idle between customers.
  useEffect(() => {
    const interval = setInterval(load, POLL_MS);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  useEffect(() => {
    searchRef.current?.focus();
    // Reach the paired thermal printer up front so the first receipt of the
    // shift prints without a pairing dialog.
    const settings = loadPrinterSettings();
    applyReceiptWidth(settings);
    reconnectThermalPrinter(settings).catch(() => {});
  }, []);

  const pendingTotal = sales.reduce((t, s) => t + Number(s.total), 0);

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <header className="bg-blue-700 text-white px-6 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold">{companyName}</h1>
          <CompanySwitcher
            activeCompanyId={activeCompanyId}
            memberships={memberships}
            redirectTo="/cashier"
            disabled={gate.disabled}
            disabledReason={gate.disabledReason}
          />
          <span className="inline-flex items-center gap-1.5 text-blue-200 text-sm">
            <Banknote size={15} /> Cashier Booth
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right text-sm">
            <div className="text-blue-200">{userName}</div>
          </div>
          {canLeaveBooth && (
            <>
              <Link href="/" className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded text-sm">
                <span className="inline-flex items-center gap-1">
                  <Store size={14} /> POS
                </span>
              </Link>
              <Link
                href="/admin"
                className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded text-sm"
              >
                <span className="inline-flex items-center gap-1">
                  <LayoutDashboard size={14} /> Admin
                </span>
              </Link>
            </>
          )}
          <button
            onClick={() => setShowPrinterSettings(true)}
            className="bg-blue-600 hover:bg-blue-500 p-2 rounded"
            title="Receipt printer settings"
            aria-label="Receipt printer settings"
          >
            <Printer size={16} />
          </button>
          <SignOutButton />
        </div>
      </header>

      {!isBoothStore && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-2 text-sm text-amber-800">
          This store takes payment at the counter, so no transactions are sent
          to the booth.{" "}
          {role === "admin" ? (
            <Link href="/admin/settings" className="font-medium underline hover:text-amber-950">
              Switch to the cashier-booth flow in Settings
            </Link>
          ) : (
            <>An admin can switch to the cashier-booth flow under Admin → Settings.</>
          )}
        </div>
      )}

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-sm bg-white">
              {(
                [
                  { id: "pending", label: "Awaiting payment" },
                  { id: "completed", label: "Paid today" },
                ] as { id: Tab; label: string }[]
              ).map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    setTab(t.id);
                    setLoading(true);
                  }}
                  className={`px-4 py-2 transition ${
                    tab === t.id ? "bg-blue-700 text-white" : "text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="relative flex-1 min-w-[220px]">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Transaction number, receipt # or customer…"
                className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none bg-white"
              />
            </div>

            <button
              onClick={load}
              className="inline-flex items-center gap-1.5 border border-gray-200 bg-white rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              <RefreshCw size={15} /> Refresh
            </button>
          </div>

          {tab === "pending" && sales.length > 0 && (
            <p className="text-sm text-gray-500 mb-3">
              {sales.length} waiting ·{" "}
              <span className="font-amount font-medium text-gray-700">
                {formatMoney(pendingTotal, currency)}
              </span>{" "}
              to collect
            </p>
          )}

          {loading ? (
            <div className="py-16 text-center text-gray-400">Loading…</div>
          ) : sales.length === 0 ? (
            <EmptyState tab={tab} searching={search.trim().length > 0} />
          ) : (
            <div className="space-y-3">
              {sales.map((sale) => (
                <TicketCard
                  key={sale.id}
                  sale={sale}
                  currency={currency}
                  onPay={() => setPayFor(sale)}
                  onCancel={() => setCancelFor(sale)}
                  onReprint={() => setReceipt(toReceipt(sale, userName))}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {payFor && (
        <PaymentModal
          sale={payFor}
          currency={currency}
          onClose={() => setPayFor(null)}
          onCompleted={(data) => {
            setPayFor(null);
            setReceipt(data);
            load();
          }}
        />
      )}

      {cancelFor && (
        <CancelTicketModal
          sale={cancelFor}
          currency={currency}
          onClose={() => setCancelFor(null)}
          onCancelled={() => {
            setCancelFor(null);
            load();
          }}
        />
      )}

      {receipt && (
        <ReceiptModal
          receipt={receipt}
          companyName={companyName}
          currency={currency}
          onNewTransaction={() => {
            setReceipt(null);
            searchRef.current?.focus();
          }}
        />
      )}

      {showPrinterSettings && (
        <PrinterSettingsModal
          companyName={companyName}
          onClose={() => setShowPrinterSettings(false)}
        />
      )}
    </div>
  );
}

// Rebuild the printable receipt from a stored sale (reprints).
function toReceipt(sale: SaleWithItems, fallbackCashier: string): ReceiptData {
  return {
    receipt_number: sale.receipt_number,
    customer_name: sale.customer_name,
    created_at: sale.created_at,
    subtotal: Number(sale.subtotal),
    discount: Number(sale.discount),
    total: Number(sale.total),
    amount_paid: Number(sale.amount_paid),
    change: Number(sale.change),
    payment_method: sale.payment_method ?? "cash",
    cheque_date: sale.cheque_date,
    payment_terms: sale.payment_terms,
    cashier_name: sale.cashier_name ?? fallbackCashier,
    items: (sale.sale_items ?? []).map((i) => ({
      product_name: i.product_name,
      unit_name: i.unit_name,
      quantity: Number(i.quantity),
      price: Number(i.price),
      total: Number(i.total),
    })),
  };
}

function TicketCard({
  sale,
  currency,
  onPay,
  onCancel,
  onReprint,
}: {
  sale: SaleWithItems;
  currency: string;
  onPay: () => void;
  onCancel: () => void;
  onReprint: () => void;
}) {
  const isPending = sale.status === "pending";
  const itemCount = sale.sale_items?.length ?? 0;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex items-center gap-4">
      <div
        className={`w-20 shrink-0 rounded-lg py-2 text-center ${
          isPending ? "bg-blue-50 text-blue-700" : "bg-gray-50 text-gray-400"
        }`}
      >
        <div className="text-[10px] uppercase tracking-wide">Txn</div>
        <div className="text-2xl font-bold font-amount leading-tight">
          {sale.ticket_number === null ? "—" : String(sale.ticket_number).padStart(3, "0")}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="font-medium text-gray-900 truncate">
          {sale.customer_name || "Walk-in customer"}
        </div>
        <div className="text-xs text-gray-400 font-code truncate">{sale.receipt_number}</div>
        <div className="text-xs text-gray-500 mt-0.5">
          {itemCount} item{itemCount === 1 ? "" : "s"} ·{" "}
          {new Date(sale.created_at).toLocaleTimeString()}
          {sale.cashier_name ? ` · ${sale.cashier_name}` : ""}
        </div>
        {!isPending && (
          <div className="text-xs text-gray-500 mt-0.5 capitalize">
            Paid by {sale.payment_method}
            {paymentDetail(sale) ? ` · ${paymentDetail(sale)}` : ""}
          </div>
        )}
      </div>

      <div className="text-right shrink-0">
        <div className="text-lg font-bold font-amount text-gray-900">
          {formatMoney(sale.total, currency)}
        </div>
        {!isPending && Number(sale.change) > 0 && (
          <div className="text-xs text-gray-400">
            change {formatMoney(sale.change, currency)}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {isPending ? (
          <>
            <button
              onClick={onCancel}
              className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-red-600 px-2 py-2"
            >
              <X size={15} /> Cancel
            </button>
            <button
              onClick={onPay}
              className="inline-flex items-center gap-1.5 bg-green-600 hover:bg-green-500 text-white px-4 py-2.5 rounded-lg text-sm font-semibold"
            >
              <Banknote size={16} /> Take Payment
            </button>
          </>
        ) : (
          <button
            onClick={onReprint}
            className="inline-flex items-center gap-1.5 border border-gray-200 hover:bg-gray-50 text-gray-700 px-4 py-2.5 rounded-lg text-sm font-medium"
          >
            <Printer size={16} /> Receipt
          </button>
        )}
      </div>
    </div>
  );
}

function EmptyState({ tab, searching }: { tab: Tab; searching: boolean }) {
  if (searching) {
    return <div className="py-16 text-center text-gray-400">Nothing matches that search.</div>;
  }
  return (
    <div className="flex flex-col items-center justify-center text-center py-20">
      <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mb-3">
        <Ticket className="text-gray-400" size={22} />
      </div>
      <p className="text-gray-500 font-medium">
        {tab === "pending" ? "No one is waiting to pay" : "Nothing paid yet today"}
      </p>
      <p className="text-gray-400 text-sm mt-1">
        {tab === "pending"
          ? "Transactions appear here the moment a sales person sends one over."
          : "Completed transactions from today are listed here for reprinting."}
      </p>
    </div>
  );
}
