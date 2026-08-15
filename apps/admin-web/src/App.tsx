import { useEffect, useState } from "react";

import { api, getToken, setToken } from "./api";
import { BarChart } from "./BarChart";

type Tab =
  | "dashboard"
  | "orders"
  | "payments"
  | "notifications"
  | "products"
  | "knowledge"
  | "handover";

interface Summary {
  ordersToday: number;
  revenue: number;
  pendingPayments: number;
  lowStock: number;
  unreadNotifications: number;
}

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}

interface Order {
  id: string;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  total: number;
  deliveryArea?: string;
  deliveryAddress?: string;
  createdAt: string;
  items?: Array<{
    name: string;
    flavor: string;
    sweetnessLevel: string;
    qty: number;
    unitPrice: number;
  }>;
}

interface Product {
  id: string;
  name: string;
  flavor: string;
  price: number;
  stock: number;
  sweetnessOptions: string[];
}

interface Payment {
  id: string;
  orderId: string;
  method: string;
  amount: number;
  status: string;
  proofMessageId?: string;
  expiredAt?: string;
}

interface Handover {
  id: string;
  conversationId: string;
  status: string;
  reason?: string;
  assignedTo?: string;
  createdAt: string;
}

interface KbDoc {
  id: string;
  title: string;
  category: string;
  status: string;
  createdAt: string;
}

function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const load = () =>
      fn()
        .then((d) => {
          if (alive) setData(d);
        })
        .catch((e: Error) => {
          if (alive) setError(e.message);
        });
    load();
    const id = setInterval(load, ms);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error };
}

function Card({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className={`card ${accent ? "accent" : ""}`}>
      <div className="card-label">{label}</div>
      <div className="card-value">{value}</div>
    </div>
  );
}

function Dashboard() {
  const { data: summary } = usePoll(() => api.get<Summary>("/api/dashboard/summary"), 15000);
  const { data: conv } = usePoll(
    () =>
      api.get<{ daily: Array<{ date: string; count: number }> }>("/api/analytics/conversations"),
    30000,
  );
  const { data: kb } = usePoll(
    () =>
      api.get<{
        queriesPerDay: Array<{ date: string; count: number }>;
        totalQueries: number;
        noAnswerRate: number;
        avgLatencyMs: number;
        activeDocs: number;
      }>("/api/analytics/knowledge"),
    30000,
  );

  return (
    <div>
      <h2>Overview</h2>
      <div className="cards">
        <Card label="Order Hari Ini" value={summary?.ordersToday ?? 0} />
        <Card
          label="Revenue"
          value={`Rp ${(summary?.revenue ?? 0).toLocaleString("id-ID")}`}
          accent
        />
        <Card label="Payment Pending" value={summary?.pendingPayments ?? 0} />
        <Card label="Stok Kritis" value={summary?.lowStock ?? 0} />
        <Card label="Notifikasi Belum Dibaca" value={summary?.unreadNotifications ?? 0} />
      </div>

      <h3>Memori — Pesan per Hari (7 hari)</h3>
      {conv?.daily.length ? (
        <BarChart data={conv.daily.map((d) => ({ label: d.date.slice(5), value: d.count }))} />
      ) : (
        <p className="muted">Belum ada data percakapan.</p>
      )}

      <h3>Knowledge — Query RAG per Hari</h3>
      {kb?.queriesPerDay.length ? (
        <BarChart
          data={kb.queriesPerDay.map((d) => ({ label: d.date.slice(5), value: d.count }))}
        />
      ) : (
        <p className="muted">Belum ada query RAG.</p>
      )}
      <div className="cards">
        <Card label="Total Query RAG" value={kb?.totalQueries ?? 0} />
        <Card label="No-answer Rate" value={`${Math.round((kb?.noAnswerRate ?? 0) * 100)}%`} />
        <Card label="Avg Latency" value={`${kb?.avgLatencyMs ?? 0} ms`} />
        <Card label="Dokumen Aktif" value={kb?.activeDocs ?? 0} />
      </div>
    </div>
  );
}

function Orders() {
  const { data: orders, error } = usePoll(() => api.get<Order[]>("/api/orders"), 10000);

  const setStatus = (id: string, status: string) =>
    api.patch(`/api/orders/${id}/status`, { status }).then(() => location.reload());

  return (
    <div>
      <h2>Orders</h2>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Metode</th>
            <th>Total</th>
            <th>Status</th>
            <th>Area</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          {(orders ?? []).map((o) => (
            <tr key={o.id}>
              <td>{o.id}</td>
              <td>
                {o.paymentMethod} ({o.paymentStatus})
              </td>
              <td>Rp {o.total.toLocaleString("id-ID")}</td>
              <td>{o.status}</td>
              <td>{o.deliveryArea ?? "-"}</td>
              <td>
                {o.paymentMethod === "cod" && o.status === "pending_confirmation" && (
                  <button
                    onClick={() =>
                      api.post(`/api/orders/${o.id}/confirm-cod`).then(() => location.reload())
                    }
                  >
                    Konfirmasi COD
                  </button>
                )}
                {o.status === "processing" && (
                  <button onClick={() => setStatus(o.id, "ready_to_deliver")}>Siap Kirim</button>
                )}
                {o.status === "ready_to_deliver" && (
                  <button onClick={() => setStatus(o.id, "out_for_delivery")}>Dikirim</button>
                )}
                {o.status === "out_for_delivery" && (
                  <button onClick={() => setStatus(o.id, "completed")}>Selesai</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Payments() {
  const { data: payments, error } = usePoll(() => api.get<Payment[]>("/api/payments"), 10000);

  const markPaid = (orderId: string) =>
    api.post(`/api/payments/${orderId}/mark-paid`).then(() => location.reload());

  return (
    <div>
      <h2>Payments — Verifikasi</h2>
      {error && <p className="error">{error}</p>}
      <button onClick={() => api.post("/api/payments/expire-due").then(() => location.reload())}>
        Jalankan Cek Expiry
      </button>
      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Metode</th>
            <th>Nominal</th>
            <th>Bukti</th>
            <th>Expired</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          {(payments ?? []).map((p) => (
            <tr key={p.id}>
              <td>{p.orderId}</td>
              <td>{p.method}</td>
              <td>Rp {p.amount.toLocaleString("id-ID")}</td>
              <td>{p.proofMessageId ? "ada" : "-"}</td>
              <td>{p.expiredAt ? new Date(p.expiredAt).toLocaleString("id-ID") : "-"}</td>
              <td>
                <button onClick={() => markPaid(p.orderId)}>Mark as Paid</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Notifications() {
  const { data, error } = usePoll(
    () => api.get<NotificationItem[]>("/api/notifications?unread=0"),
    5000,
  );

  const markRead = (id: string) =>
    api.post(`/api/notifications/${id}/read`).then(() => location.reload());

  return (
    <div>
      <h2>Notifications</h2>
      {error && <p className="error">{error}</p>}
      <ul className="notif-list">
        {(data ?? []).map((n) => (
          <li key={n.id} className={n.isRead ? "notif read" : "notif"}>
            <strong>{n.title}</strong>
            <span>{n.message}</span>
            <small>{new Date(n.createdAt).toLocaleString("id-ID")}</small>
            {!n.isRead && <button onClick={() => markRead(n.id)}>Tandai dibaca</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Products() {
  const { data: products, error } = usePoll(() => api.get<Product[]>("/api/products"), 10000);

  const update = (id: string, patch: Partial<Product>) =>
    api.patch(`/api/products/${id}`, patch).then(() => location.reload());

  return (
    <div>
      <h2>Products &amp; Stock</h2>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr>
            <th>Nama</th>
            <th>Rasa</th>
            <th>Harga</th>
            <th>Stok</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          {(products ?? []).map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.flavor}</td>
              <td>
                <input
                  type="number"
                  defaultValue={p.price}
                  onBlur={(e) => update(p.id, { price: Number(e.target.value) })}
                />
              </td>
              <td>
                <input
                  type="number"
                  defaultValue={p.stock}
                  onBlur={(e) => update(p.id, { stock: Number(e.target.value) })}
                />
              </td>
              <td>{p.stock <= 5 ? <span className="badge">Stok kritis</span> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Knowledge() {
  const { data: docs, error } = usePoll(() => api.get<KbDoc[]>("/api/knowledge"), 10000);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("general");

  const add = () => {
    if (!title) return;
    api.post("/api/knowledge", { title, category }).then(() => location.reload());
  };

  return (
    <div>
      <h2>Knowledge Base</h2>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <input
          placeholder="Judul dokumen"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          placeholder="Kategori"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
        <button onClick={add}>Tambah</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Judul</th>
            <th>Kategori</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {(docs ?? []).map((d) => (
            <tr key={d.id}>
              <td>{d.title}</td>
              <td>{d.category}</td>
              <td>{d.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Handover() {
  const { data: handovers, error } = usePoll(() => api.get<Handover[]>("/api/handovers"), 10000);
  const [convId, setConvId] = useState("");
  const [reason, setReason] = useState("");

  const create = () => {
    if (!convId) return;
    api.post("/api/handovers", { conversationId: convId, reason }).then(() => location.reload());
  };

  return (
    <div>
      <h2>Human Handover</h2>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <input
          placeholder="Conversation ID"
          value={convId}
          onChange={(e) => setConvId(e.target.value)}
        />
        <input placeholder="Alasan" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button onClick={create}>Buat Handover</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Conversation</th>
            <th>Status</th>
            <th>Alasan</th>
            <th>Assigned To</th>
            <th>Aksi</th>
          </tr>
        </thead>
        <tbody>
          {(handovers ?? []).map((h) => (
            <tr key={h.id}>
              <td>{h.conversationId}</td>
              <td>{h.status}</td>
              <td>{h.reason ?? "-"}</td>
              <td>{h.assignedTo ?? "-"}</td>
              <td>
                {h.status === "open" && (
                  <button
                    onClick={() =>
                      api.post(`/api/handovers/${h.id}/assign`).then(() => location.reload())
                    }
                  >
                    Ambil alih
                  </button>
                )}
                {h.status === "assigned" && (
                  <button
                    onClick={() =>
                      api.post(`/api/handovers/${h.id}/resolve`).then(() => location.reload())
                    }
                  >
                    Selesaikan
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "orders", label: "Orders" },
  { id: "payments", label: "Payments" },
  { id: "notifications", label: "Notifications" },
  { id: "products", label: "Products & Stock" },
  { id: "knowledge", label: "Knowledge Base" },
  { id: "handover", label: "Handover" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [tokenInput, setTokenInput] = useState(getToken());

  const views: Record<Tab, React.ReactNode> = {
    dashboard: <Dashboard />,
    orders: <Orders />,
    payments: <Payments />,
    notifications: <Notifications />,
    products: <Products />,
    knowledge: <Knowledge />,
    handover: <Handover />,
  };

  return (
    <main className="container">
      <div className="header">
        <h1>Soysu Admin</h1>
        <input
          className="token"
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          onBlur={() => setToken(tokenInput)}
          placeholder="Admin token"
        />
      </div>
      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "tab active" : "tab"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {views[tab]}
    </main>
  );
}
