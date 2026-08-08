"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, Coins, Download, Printer, Receipt, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { formatMoney, paymentDetail } from "@/lib/config";
import {
  computeCollections,
  methodLabel,
  type CollectionRow,
  type CollectionsReport,
} from "@/lib/collections";
import { PrintHeader, SignatureBlock } from "@/components/collections/RemittanceSlip";

// Every column the sheet or the CSV can show. One unbroken literal, not a
// concatenation: supabase-js parses the select string at the type level, and
// `"a, " + "b"` widens to `string`, which makes the row type collapse to
// GenericStringError[].
const SELECT =
  "id, receipt_number, ticket_number, customer_name, payment_method, total, created_at, completed_at, cashier_id, cashier_name, completed_by, completed_by_name, cheque_date, payment_terms, settled_at, settled_by_name";

type RawSale = {
  id: string;
  receipt_number: string;
  ticket_number: number | null;
  customer_name: string | null;
  payment_method: string | null;
  total: number | string;
  created_at: string;
  completed_at: string | null;
  cashier_id: string | null;
  cashier_name: string | null;
  completed_by: string | null;
  completed_by_name: string | null;
  cheque_date: string | null;
  payment_terms: string | null;
  settled_at: string | null;
  settled_by_name: string | null;
};

const isoDay = (d: Date) => {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
};

const fullDate = new Intl.DateTimeFormat("en-PH", {
  month: "long",
  day: "numeric",
  year: "numeric",
});
const timeOnly = new Intl.DateTimeFormat("en-PH", { hour: "numeric", minute: "2-digit" });
const dateTime = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\n");
}

export function CollectionsManager({
  companyName,
  currency,
  scopeUserId,
  scopeName,
}: {
  companyName: string;
  currency: string;
  /** null → the whole store. A uid → pinned to that person, decided on the
   *  server from who is signed in, never from a control on this page. */
  scopeUserId: string | null;
  scopeName: string;
}) {
  const supabase = createClient();
  const today = isoDay(new Date());
  // Defaults to TODAY, unlike /admin/reports' longer ranges: a remittance
  // sheet is one shift's money being counted out, and opening on a month would
  // show a figure nobody is about to hand over.
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<CollectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [printedAt, setPrintedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const startIso = new Date(`${from}T00:00:00`).toISOString();
    const endIso = new Date(`${to}T23:59:59.999`).toISOString();

    // Paged rather than a bare .limit(): PostgREST caps a response at 1000
    // rows, and a silently truncated remittance sheet hides money.
    const sales = await fetchAllRows<RawSale>((a, b) => {
      let q = supabase
        .from("sales")
        .select(SELECT)
        .eq("is_voided", false)
        .eq("status", "completed")
        .gte("created_at", startIso)
        .lte("created_at", endIso);
      // Own-sheet scope. Covers both flows: direct sales carry cashier_id,
      // booth sales carry completed_by.
      if (scopeUserId) {
        q = q.or(`completed_by.eq.${scopeUserId},cashier_id.eq.${scopeUserId}`);
      }
      return q.order("created_at").range(a, b);
    });

    // Settlements are a separate event with their own date and their own
    // collector, so they need their own query — a cheque raised in March and
    // paid in August is August's money. Skipped for an own-sheet: settle_sale()
    // requires is_company_manager(), so a booth cashier can never appear here.
    const settlements = scopeUserId
      ? []
      : await fetchAllRows<RawSale>((a, b) =>
          supabase
            .from("sales")
            .select(SELECT)
            .eq("is_voided", false)
            .in("payment_method", ["cheque", "terms"])
            .gte("settled_at", startIso)
            .lte("settled_at", endIso)
            .order("settled_at")
            .range(a, b)
        );

    const saleRows: CollectionRow[] = sales.map((s) => {
      const isCash = s.payment_method === "cash";
      return {
        id: s.id,
        kind: isCash ? "cash" : "receivable",
        receiptNumber: s.receipt_number,
        ticketNumber: s.ticket_number,
        customerName: s.customer_name,
        method: s.payment_method,
        total: Number(s.total),
        collected: isCash ? Number(s.total) : 0,
        at: s.completed_at ?? s.created_at,
        handledById: s.completed_by ?? s.cashier_id,
        handledByName: s.completed_by_name ?? s.cashier_name,
        detail: paymentDetail(s),
      };
    });

    const settlementRows: CollectionRow[] = settlements.map((s) => ({
      // Prefixed: a cheque raised AND settled inside one range legitimately
      // appears twice — once as credit extended, once as money collected — and
      // React needs the two rows to have different keys.
      id: `settled:${s.id}`,
      kind: "settlement",
      receiptNumber: s.receipt_number,
      ticketNumber: s.ticket_number,
      customerName: s.customer_name,
      method: s.payment_method,
      total: Number(s.total),
      collected: Number(s.total),
      at: s.settled_at!,
      handledById: null,
      handledByName: s.settled_by_name,
      detail: paymentDetail(s),
    }));

    setRows([...saleRows, ...settlementRows]);
    setLoading(false);
  }, [supabase, from, to, scopeUserId]);

  // Debounced like CollectiblesManager: a date input fires on every keystroke
  // while a year is typed, and each one would otherwise start a paged scan.
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const report: CollectionsReport = useMemo(() => computeCollections(rows), [rows]);

  const singleDay = from === to;
  const allStaff = scopeUserId === null;
  const period = singleDay
    ? fullDate.format(new Date(`${from}T00:00:00`))
    : `${fullDate.format(new Date(`${from}T00:00:00`))} – ${fullDate.format(
        new Date(`${to}T00:00:00`)
      )}`;

  function print() {
    // Stamped just before the dialog opens, so the printed "Printed" line is
    // the moment the paper was produced rather than page load.
    setPrintedAt(new Date());
    // Let the stamp paint before the dialog blocks the thread.
    setTimeout(() => window.print(), 0);
  }

  function exportCsv() {
    const csv = toCsv(
      ["When", "Type", "Receipt", "Customer", "Method", "Detail", "Collected by", "Face value", "Collected"],
      report.rows.map((r) => [
        new Date(r.at).toISOString().replace("T", " ").slice(0, 16),
        r.kind === "cash" ? "Cash sale" : r.kind === "settlement" ? "Settlement" : "Receivable",
        r.receiptNumber,
        r.customerName ?? "",
        methodLabel(r.method),
        r.detail ?? "",
        r.handledByName ?? "",
        r.total,
        r.collected,
      ])
    );
    // The BOM makes Excel read it as UTF-8; without it ₱ and accented names arrive mangled.
    const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `collections-${scopeName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${from}_to_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return singleDay ? timeOnly.format(d) : dateTime.format(d);
  };

  return (
    // `print-sheet` claims the bond-paper @page (see globals.css). On paper the
    // page collapses to three things: who/when, the transactions, and the
    // signatures. Everything else is print:hidden — a screen summary the clerk
    // already read is a second sheet nobody asked to carry.
    <div className="print-sheet p-6 print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Collections</h1>
          <p className="text-sm text-gray-500">
            {period} · {scopeName}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportCsv}
            disabled={report.rows.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
          <button
            onClick={print}
            disabled={report.rows.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
          >
            <Printer className="w-4 h-4" /> Print
          </button>
        </div>
      </div>

      <PrintHeader
        companyName={companyName}
        period={period}
        scope={scopeName}
        printedAt={printedAt ?? new Date()}
      />

      {/* Dates and nothing else. Whose sheet this is was decided on the server
          by who signed in — it was never a control a clerk could move. */}
      <div className="flex flex-wrap items-end gap-3 mb-4 bg-white rounded-xl shadow-sm p-4 print:hidden">
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">From</span>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">To</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
          />
        </label>
        <button
          onClick={() => {
            setFrom(today);
            setTo(today);
          }}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50"
        >
          Today
        </button>
      </div>

      {/* Screen only. Cash and total are restated beside the signatures, so
          printing these tiles would spend a third of the sheet repeating them. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-4 print:hidden">
        <StatCard
          label="Cash to remit"
          value={formatMoney(report.cash, currency)}
          hint="Counted out and handed over"
          Icon={Banknote}
          accent="text-emerald-600"
        />
        <StatCard
          label="Settled receivables"
          value={formatMoney(report.nonCash, currency)}
          hint="Cheque / terms marked paid in this period"
          Icon={Wallet}
          accent="text-violet-600"
        />
        <StatCard
          label="Total collected"
          value={formatMoney(report.total, currency)}
          hint={singleDay ? "For this day" : "For this range"}
          Icon={Coins}
          accent="text-blue-600"
        />
        <StatCard
          label="Credit extended"
          value={formatMoney(report.receivableAmount, currency)}
          hint={`${report.receivableCount} cheque/terms sale${
            report.receivableCount === 1 ? "" : "s"
          } — not collected`}
          Icon={Receipt}
          accent="text-amber-600"
        />
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden print:rounded-none print:shadow-none">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between print:hidden">
          <h2 className="font-semibold text-gray-900">Transactions</h2>
          <span className="text-sm text-gray-500">
            {report.rows.length} row{report.rows.length === 1 ? "" : "s"}
          </span>
        </div>

        {loading ? (
          <p className="px-5 py-8 text-sm text-gray-500">Loading…</p>
        ) : report.rows.length === 0 ? (
          <p className="px-5 py-8 text-sm text-gray-500">
            No collections in this range. Nothing to remit.
          </p>
        ) : (
          // Never paginated: this is the sheet counted against a drawer, and a
          // page 2 that never prints would hide money. Scrolls on screen,
          // prints in full.
          <div className="max-h-[32rem] overflow-auto print:max-h-none print:overflow-visible">
            <table className="w-full text-sm print:text-[9px] print:leading-tight">
              <thead className="bg-gray-50 text-xs uppercase tracking-wider text-gray-500 sticky top-0 print:static">
                <tr>
                  <Th>{singleDay ? "Time" : "When"}</Th>
                  <Th>Receipt</Th>
                  <Th>Customer</Th>
                  <Th>Method</Th>
                  {allStaff ? <Th>Collected by</Th> : null}
                  <Th right>Collected</Th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-gray-100 break-inside-avoid"
                  >
                    <Td className="whitespace-nowrap text-gray-500 tabular-nums">
                      {fmtTime(r.at)}
                    </Td>
                    <Td>
                      <span className="font-medium">{r.receiptNumber}</span>
                      {r.kind === "settlement" ? (
                        <span className="ml-1 text-[10px] font-medium text-violet-600 print:text-[7px]">
                          SETTLED
                        </span>
                      ) : null}
                    </Td>
                    <Td>{r.customerName || "—"}</Td>
                    <Td>
                      {methodLabel(r.method)}
                      {r.detail ? (
                        <span className="block text-xs text-gray-500 print:ml-1 print:inline print:text-[8px]">
                          {r.detail}
                        </span>
                      ) : null}
                    </Td>
                    {allStaff ? <Td>{r.handledByName ?? "Unattributed"}</Td> : null}
                    <Td right>
                      {r.kind === "receivable" ? (
                        // Shown at zero rather than dropped: the goods left the
                        // store on this shift, and a sheet that omits the sale
                        // entirely looks like it never happened.
                        <span className="text-amber-600">
                          — <span className="text-xs">on credit</span>
                        </span>
                      ) : (
                        <span className="font-medium tabular-nums">
                          {formatMoney(r.collected, currency)}
                        </span>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
              {/* Cash first: it is the line the two people signing actually
                  count out between them. */}
              <tfoot className="break-inside-avoid">
                <tr className="bg-gray-50 border-t border-gray-200 font-medium">
                  <Td colSpan={allStaff ? 5 : 4}>Cash to remit</Td>
                  <Td right>{formatMoney(report.cash, currency)}</Td>
                </tr>
                <tr className="border-t border-gray-100 text-gray-600">
                  <Td colSpan={allStaff ? 5 : 4}>Settled receivables</Td>
                  <Td right>{formatMoney(report.nonCash, currency)}</Td>
                </tr>
                <tr className="bg-gray-50 border-t border-gray-200 font-semibold">
                  <Td colSpan={allStaff ? 5 : 4}>
                    Total collected · {report.count} transaction
                    {report.count === 1 ? "" : "s"}
                  </Td>
                  <Td right>{formatMoney(report.total, currency)}</Td>
                </tr>
                {report.receivableCount > 0 ? (
                  <tr className="border-t border-gray-100 text-amber-700">
                    <Td colSpan={allStaff ? 5 : 4}>
                      Credit extended this period · {report.receivableCount} sale
                      {report.receivableCount === 1 ? "" : "s"} (not collected)
                    </Td>
                    <Td right>{formatMoney(report.receivableAmount, currency)}</Td>
                  </tr>
                ) : null}
              </tfoot>
            </table>
          </div>
        )}
      </div>

      <SignatureBlock cash={report.cash} total={report.total} currency={currency} />
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`px-4 py-2 font-semibold print:px-1.5 print:py-0.5 ${
        right ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

// Print density is won or lost on the row: comfortable screen padding costs
// roughly eight rows a page.
function Td({
  children,
  right,
  colSpan,
  className = "",
}: {
  children: React.ReactNode;
  right?: boolean;
  colSpan?: number;
  className?: string;
}) {
  return (
    <td
      colSpan={colSpan}
      className={`px-4 py-2.5 print:px-1.5 print:py-[1px] ${
        right ? "text-right" : ""
      } ${className}`}
    >
      {children}
    </td>
  );
}

function StatCard({
  label,
  value,
  hint,
  Icon,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  Icon: React.ComponentType<{ className?: string }>;
  accent: string;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">{label}</span>
        <Icon className={`w-4 h-4 ${accent}`} />
      </div>
      <p
        // Every one of these labels also appears in the table footer, so the
        // e2e sheet-arithmetic check needs an unambiguous handle on the tile.
        data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}
        className="mt-1 text-xl font-bold text-gray-900 font-amount"
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs text-gray-400">{hint}</p>
    </div>
  );
}
