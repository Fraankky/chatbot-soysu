import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Download, MoreHorizontal, Search, Sparkles, TrendingUp } from "lucide-react";

import { api } from "../api";
import type { MonthlySalesData, Transaction } from "../types/dashboard";

interface Summary {
  ordersToday: number;
  revenue: number;
  pendingPayments: number;
  lowStock: number;
  unreadNotifications: number;
}

interface ConversationAnalytics {
  daily: Array<{ date: string; count: number }>;
  active: number;
  botMessages: number;
}

interface Order {
  id: string;
  customerName?: string | null;
  status: string;
  total: number;
  paymentStatus: string;
  items?: Array<{ name: string; qty: number; unitPrice: number }>;
}

function useDashboardData() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [analytics, setAnalytics] = useState<ConversationAnalytics | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => {
    const load = () => {
      void Promise.all([
        api.get<Summary>("/api/dashboard/summary").then(setSummary),
        api.get<ConversationAnalytics>("/api/analytics/conversations").then(setAnalytics),
        api.get<Order[]>("/api/orders").then(setOrders),
      ]);
    };
    load();
    const timer = window.setInterval(load, 15000);
    return () => window.clearInterval(timer);
  }, []);

  return { summary, analytics, orders };
}

function formatCurrency(value: number) {
  return `Rp ${value.toLocaleString("id-ID")}`;
}

function MetricCard({
  title,
  value,
  subText,
  trend,
}: {
  title: string;
  value: string;
  subText: string;
  trend: "up" | "down";
}) {
  return (
    <article className="metric-card">
      <div className="metric-card__top">
        <span>{title}</span>
        <TrendingUp className={trend === "up" ? "trend-up" : "trend-down"} size={15} />
      </div>
      <strong className="metric-card__value">{value}</strong>
      <div className="metric-card__bottom">
        <span className={trend === "up" ? "trend-up" : "trend-down"}>{subText}</span>
        <span className="micro-bars" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
      </div>
    </article>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {payload.map((entry) => (
        <span key={entry.name}>
          {entry.name}: {entry.value}
        </span>
      ))}
    </div>
  );
}

export default function AdminDashboard() {
  const { summary, analytics, orders } = useDashboardData();
  const [query, setQuery] = useState("");

  const salesData: MonthlySalesData[] = (analytics?.daily ?? []).map((item) => ({
    month: item.date.slice(5),
    newUser: item.count,
    existingUser: 0,
  }));

  const transactions: Transaction[] = useMemo(
    () =>
      orders.map((order) => {
        const item = order.items?.[0];
        const status: Transaction["status"] =
          order.paymentStatus === "paid" || order.status === "completed"
            ? "Success"
            : order.status === "cancelled"
              ? "Refunded"
              : "Pending";
        return {
          id: order.id,
          customer: order.customerName ?? "Customer",
          product: item?.name ?? "Order",
          status,
          qty: item?.qty ?? 0,
          price: formatCurrency(item?.unitPrice ?? 0),
          total: formatCurrency(order.total),
        };
      }),
    [orders],
  ).filter((row) =>
    `${row.id} ${row.customer} ${row.product}`.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="dashboard-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Overview / Today</p>
          <h2>Good morning, admin.</h2>
        </div>
        <button className="button button--dark" onClick={() => window.print()}>
          <Download size={15} /> Export view
        </button>
      </div>

      <section className="metric-grid">
        <MetricCard
          title="Total Revenue"
          value={formatCurrency(summary?.revenue ?? 0)}
          subText="Live from orders"
          trend="up"
        />
        <MetricCard
          title="Total Orders"
          value={String(summary?.ordersToday ?? 0)}
          subText="Orders today"
          trend="up"
        />
        <MetricCard
          title="Active Conversations"
          value={String(analytics?.active ?? 0)}
          subText="Currently active"
          trend="up"
        />
        <MetricCard title="Conversion Rate" value="--" subText="Not tracked yet" trend="down" />
      </section>

      <section className="analytics-grid">
        <article className="panel panel--wide">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Activity</p>
              <h3>Sales trend</h3>
            </div>
            <span className="legend">
              <i /> Messages
            </span>
          </div>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={salesData} barGap={4}>
                <CartesianGrid vertical={false} stroke="#e4e4e7" strokeDasharray="3 3" />
                <XAxis
                  dataKey="month"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "#a1a1aa", fontSize: 11 }}
                />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <Bar
                  dataKey="newUser"
                  name="New"
                  stackId="messages"
                  fill="#18181b"
                  radius={[4, 4, 0, 0]}
                />
                <Bar dataKey="existingUser" name="Existing" stackId="messages" fill="#d4d4d8" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Revenue</p>
              <h3>Breakdown</h3>
            </div>
            <Sparkles size={16} />
          </div>
          <div className="insight">
            <Sparkles size={15} />
            <span>Connect product analytics to unlock AI insights.</span>
          </div>
          <div className="chart-wrap chart-wrap--small">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={orders
                  .slice(0, 8)
                  .map((order) => ({ name: order.id.slice(-4), value: order.total }))}
              >
                <XAxis dataKey="name" hide />
                <YAxis hide />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="value" fill="#27272a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </section>

      <section className="panel transactions-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Orders</p>
            <h3>Recent transactions</h3>
          </div>
          <div className="table-search">
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter transactions"
            />
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" aria-label="Select all" />
                </th>
                <th>ID</th>
                <th>Customer</th>
                <th>Product</th>
                <th>Status</th>
                <th>Qty</th>
                <th>Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {transactions.slice(0, 8).map((row) => (
                <tr key={row.id}>
                  <td>
                    <input type="checkbox" aria-label={`Select ${row.id}`} />
                  </td>
                  <td className="mono muted">{row.id}</td>
                  <td className="strong">{row.customer}</td>
                  <td>{row.product}</td>
                  <td>
                    <span className={`status status--${row.status.toLowerCase()}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="mono">{row.qty}</td>
                  <td className="mono strong">{row.total}</td>
                  <td>
                    <button className="icon-button" aria-label={`Actions for ${row.id}`}>
                      <MoreHorizontal size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!transactions.length && <p className="empty-state">No transactions found.</p>}
      </section>
    </div>
  );
}
