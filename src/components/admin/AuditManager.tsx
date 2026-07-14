"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AuditLog } from "@/lib/types";
import { ChevronDown, ChevronRight } from "lucide-react";

const ACTIONS = [
  "",
  "SALE_CREATED",
  "SALE_VOIDED",
  "SALE_RETURNED",
  "STOCK_RECEIVED",
  "STOCK_ADJUSTED",
];

const actionColor: Record<string, string> = {
  SALE_CREATED: "bg-green-100 text-green-700",
  SALE_VOIDED: "bg-red-100 text-red-700",
  SALE_RETURNED: "bg-amber-100 text-amber-700",
  STOCK_RECEIVED: "bg-blue-100 text-blue-700",
  STOCK_ADJUSTED: "bg-violet-100 text-violet-700",
};

function isoDay(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function AuditManager() {
  const supabase = createClient();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 7 * 864e5)));
  const [to, setTo] = useState(() => isoDay(new Date()));
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("audit_logs")
      .select("*")
      .gte("created_at", new Date(from + "T00:00:00").toISOString())
      .lte("created_at", new Date(to + "T23:59:59.999").toISOString())
      .order("created_at", { ascending: false })
      .limit(300);
    if (action) q = q.eq("action", action);
    const { data } = await q;
    setLogs((data as AuditLog[]) ?? []);
    setLoading(false);
  }, [supabase, action, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Audit Log</h1>

      <div className="flex flex-wrap items-end gap-3 mb-4 bg-white rounded-xl shadow-sm p-4">
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">Action</span>
          <select value={action} onChange={(e) => setAction(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
            {ACTIONS.map((a) => (
              <option key={a} value={a}>{a || "All actions"}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">From</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">To</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        </label>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-10 text-center text-gray-400">Loading…</div>
        ) : logs.length === 0 ? (
          <div className="p-10 text-center text-gray-400">No audit entries.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
              <tr>
                <th className="w-8 px-3 py-3" />
                <th className="text-left px-5 py-3">Timestamp</th>
                <th className="text-left px-5 py-3">User</th>
                <th className="text-left px-5 py-3">Action</th>
                <th className="text-left px-5 py-3">Entity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.map((l) => (
                <Fragment key={l.id}>
                  <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
                    <td className="px-3 py-3 text-gray-400">
                      {expanded === l.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </td>
                    <td className="px-5 py-3 text-gray-500 whitespace-nowrap">{new Date(l.created_at).toLocaleString()}</td>
                    <td className="px-5 py-3">{l.user_name ?? "—"}</td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${actionColor[l.action] ?? "bg-gray-100 text-gray-600"}`}>{l.action}</span>
                    </td>
                    <td className="px-5 py-3 text-gray-500">{l.entity_type ?? "—"}</td>
                  </tr>
                  {expanded === l.id && (
                    <tr className="bg-gray-50">
                      <td />
                      <td colSpan={4} className="px-5 py-3">
                        <pre className="font-code text-xs bg-white border border-gray-200 rounded-lg p-3 overflow-auto">
                          {JSON.stringify(l.details ?? {}, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
