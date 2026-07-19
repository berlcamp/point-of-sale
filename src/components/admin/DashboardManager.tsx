"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAdmin } from "@/components/admin/AdminProvider";
import { formatMoney } from "@/lib/config";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Receipt, TrendingUp, DollarSign, AlertTriangle } from "lucide-react";

const PALETTE = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed"];

const DAY_PRESETS = [
  { label: "Today", days: 1 },
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

// Range covering the last `days` days up to end of today (inclusive).
function rangeForDays(days: number) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

function periodLabel(days: number) {
  return days === 1 ? "today" : `last ${days} days`;
}

export function DashboardManager() {
  const supabase = createClient();
  const { currency } = useAdmin();
  const [days, setDays] = useState(1);
  const [summary, setSummary] = useState<{ revenue: number; transactions: number; gross_profit: number } | null>(null);
  const [byDay, setByDay] = useState<{ date: string; revenue: number }[]>([]);
  const [top, setTop] = useState<{ product_name: string; revenue: number }[]>([]);
  const [payments, setPayments] = useState<{ method: string; total: number }[]>([]);
  const [lowStock, setLowStock] = useState<{ id: string; name: string; quantity: number; low_stock: number }[]>([]);
  const [loading, setLoading] = useState(true);

  // Chart always shows a trend of at least a week regardless of the summary range.
  const chartDays = Math.max(days, 7);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { start, end } = rangeForDays(days);
      const [s, d, t, p, ls] = await Promise.all([
        supabase.rpc("report_summary", { p_from: start, p_to: end }),
        supabase.rpc("report_sales_by_day", { p_days: chartDays }),
        supabase.rpc("report_top_products", { p_from: start, p_to: end, p_limit: 5 }),
        supabase.rpc("report_payment_breakdown", { p_from: start, p_to: end }),
        supabase
          .from("products")
          .select("id, name, inventory(quantity, low_stock)")
          .order("name"),
      ]);
      setSummary(s.data ?? null);
      setByDay((d.data ?? []).map((r: { date: string; revenue: number }) => ({ date: r.date.slice(5), revenue: Number(r.revenue) })));
      setTop((t.data ?? []).map((r: { product_name: string; revenue: number }) => ({ product_name: r.product_name, revenue: Number(r.revenue) })));
      setPayments((p.data ?? []).map((r: { method: string; total: number }) => ({ method: r.method, total: Number(r.total) })));
      const low = ((ls.data ?? []) as {
        id: string;
        name: string;
        inventory: { quantity: number; low_stock: number } | { quantity: number; low_stock: number }[] | null;
      }[])
        .map((x) => {
          const inv = Array.isArray(x.inventory) ? x.inventory[0] : x.inventory;
          return { id: x.id, name: x.name, quantity: Number(inv?.quantity ?? 0), low_stock: Number(inv?.low_stock ?? 0) };
        })
        .filter((x) => x.quantity <= x.low_stock);
      setLowStock(low);
      setLoading(false);
    })();
  }, [supabase, days, chartDays]);

  const period = periodLabel(days);

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <div className="flex gap-1 bg-white rounded-xl shadow-sm p-1">
          {DAY_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setDays(p.days)}
              className={`px-3 py-1.5 text-sm rounded-lg transition ${
                days === p.days ? "bg-blue-600 text-white" : "text-gray-500 hover:bg-gray-50"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="p-10 text-center text-gray-400">Loading dashboard…</div>
      ) : (
      <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={<Receipt size={20} />} label={`Transactions (${period})`} value={String(summary?.transactions ?? 0)} color="blue" />
        <StatCard icon={<DollarSign size={20} />} label={`Revenue (${period})`} value={formatMoney(summary?.revenue ?? 0, currency)} color="green" />
        <StatCard icon={<TrendingUp size={20} />} label={`Profit (${period})`} value={formatMoney(summary?.gross_profit ?? 0, currency)} color="violet" />
        <StatCard icon={<AlertTriangle size={20} />} label="Low Stock Items" value={String(lowStock.length)} color="red" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title={`Revenue (last ${chartDays} days)`}>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={byDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
              <XAxis dataKey="date" fontSize={12} stroke="#94a3b8" />
              <YAxis fontSize={12} stroke="#94a3b8" />
              <Tooltip formatter={(v) => formatMoney(Number(v), currency)} />
              <Line type="monotone" dataKey="revenue" stroke="#2563eb" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        <Card title={`Top Products (${period})`}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={top} layout="vertical" margin={{ left: 20 }}>
              <XAxis type="number" fontSize={12} stroke="#94a3b8" />
              <YAxis type="category" dataKey="product_name" width={110} fontSize={12} stroke="#94a3b8" />
              <Tooltip formatter={(v) => formatMoney(Number(v), currency)} />
              <Bar dataKey="revenue" fill="#16a34a" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title={`Payment Methods (${period})`}>
          {payments.length === 0 ? (
            <Empty />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={payments} dataKey="total" nameKey="method" cx="50%" cy="50%" outerRadius={90} label>
                  {payments.map((_, i) => (
                    <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => formatMoney(Number(v), currency)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Low Stock">
          {lowStock.length === 0 ? (
            <Empty label="All stocked up 🎉" />
          ) : (
            <div className="max-h-60 overflow-auto">
              <table className="w-full text-sm">
                <thead className="text-gray-500 text-xs uppercase">
                  <tr>
                    <th className="text-left py-2">Product</th>
                    <th className="text-right py-2">Stock</th>
                    <th className="text-right py-2">Min</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {lowStock.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2">{l.name}</td>
                      <td className="py-2 text-right text-red-600 font-semibold">{l.quantity}</td>
                      <td className="py-2 text-right text-gray-500">{l.low_stock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      </>
      )}
    </div>
  );
}

const badge: Record<string, string> = {
  blue: "bg-blue-100 text-blue-700",
  green: "bg-green-100 text-green-700",
  violet: "bg-violet-100 text-violet-700",
  red: "bg-red-100 text-red-700",
};

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-5">
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${badge[color]}`}>{icon}</div>
      <div className="text-2xl font-bold text-gray-900 font-amount">{value}</div>
      <div className="text-gray-500 text-sm">{label}</div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-5">
      <h3 className="font-semibold text-gray-800 mb-4">{title}</h3>
      {children}
    </div>
  );
}

function Empty({ label = "No data yet" }: { label?: string }) {
  return <div className="h-60 flex items-center justify-center text-gray-400 text-sm">{label}</div>;
}
