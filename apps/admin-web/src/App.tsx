import { useEffect, useState } from "react";
import QRCode from "qrcode";

import { api, getToken, setToken } from "./api";
import AdminDashboard from "./components/AdminDashboard";
import AssistantPlayground from "./components/AssistantPlayground";

type Tab =
  | "dashboard"
  | "assistant"
  | "whatsapp"
  | "orders"
  | "payments"
  | "notifications"
  | "products"
  | "knowledge"
  | "handover";

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
          if (alive) {
            setData(d);
            setError("");
          }
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

function MenuPage({
  eyebrow,
  title,
  actions,
  children,
}: {
  eyebrow: string;
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="menu-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function DataState({
  error,
  loading,
  empty,
  children,
}: {
  error: string;
  loading: boolean;
  empty: boolean;
  children: React.ReactNode;
}) {
  if (error) return <div className="state state--error">{error}</div>;
  if (loading) return <div className="state">Loading data...</div>;
  if (empty) return <div className="state">No data available yet.</div>;
  return children;
}

interface WhatsAppStatus {
  status: "not_paired" | "qr_ready" | "connecting" | "connected" | "disconnected";
  phoneNumber: string | null;
  deviceName: string | null;
  qr: string | null;
  lastError: string | null;
  updatedAt: string | null;
}

function WhatsApp() {
  const { data, error } = usePoll(() => api.get<WhatsAppStatus>("/api/whatsapp/status"), 3000);
  const [qrImage, setQrImage] = useState("");
  const [action, setAction] = useState("");
  useEffect(() => {
    if (data?.qr) void QRCode.toDataURL(data.qr).then(setQrImage);
    else setQrImage("");
  }, [data?.qr]);
  const sendCommand = (command: "connect" | "unpair") => {
    setAction(command);
    void api
      .post(`/api/whatsapp/${command}`)
      .then(() => setAction(""))
      .catch(() => setAction(""));
  };

  return (
    <div className="whatsapp-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Channel / WhatsApp</p>
          <h2>Connection</h2>
        </div>
        <span className={`status status--${data?.status ?? "pending"}`}>
          {data?.status ?? "loading"}
        </span>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="connection-card">
        {qrImage ? (
          <div className="qr-box">
            <img src={qrImage} alt="WhatsApp pairing QR code" width={280} height={280} />
            <p>WhatsApp → Settings → Linked devices → Link a device</p>
          </div>
        ) : (
          <div className="empty-state">
            {data?.status === "connected"
              ? "WhatsApp is connected."
              : data?.status === "qr_ready"
                ? "QR expired. Click Connect to generate a new one."
                : "QR belum tersedia. Tekan Connect."}
          </div>
        )}
        <div className="connection-meta">
          <p>
            <span>Phone</span>
            {data?.phoneNumber ?? "-"}
          </p>
          <p>
            <span>Device</span>
            {data?.deviceName ?? "-"}
          </p>
          <p>
            <span>Last update</span>
            {data?.updatedAt ? new Date(data.updatedAt).toLocaleString("id-ID") : "-"}
          </p>
          {data?.lastError && (
            <p className="error">
              <span>Last error</span>
              {data.lastError}
            </p>
          )}
        </div>
      </div>
      <div className="row">
        <button disabled={Boolean(action)} onClick={() => sendCommand("connect")}>
          {action === "connect" ? "Starting..." : "Connect"}
        </button>
        <button disabled={Boolean(action)} onClick={() => sendCommand("unpair")}>
          {action === "unpair" ? "Unpairing..." : "Unpair"}
        </button>
      </div>
    </div>
  );
}

function Orders() {
  const { data: orders, error } = usePoll(() => api.get<Order[]>("/api/orders"), 10000);

  const setStatus = (id: string, status: string) =>
    api.patch(`/api/orders/${id}/status`, { status }).then(() => location.reload());

  return (
    <MenuPage eyebrow="Management / Orders" title="Orders">
      <div className="panel table-panel">
        <DataState error={error} loading={!orders} empty={!orders?.length}>
          <div className="table-scroll">
            <table className="data-table">
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
                            api
                              .post(`/api/orders/${o.id}/confirm-cod`)
                              .then(() => location.reload())
                          }
                        >
                          Konfirmasi COD
                        </button>
                      )}
                      {o.status === "processing" && (
                        <button onClick={() => setStatus(o.id, "ready_to_deliver")}>
                          Siap Kirim
                        </button>
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
        </DataState>
      </div>
    </MenuPage>
  );
}

function Payments() {
  const { data: payments, error } = usePoll(() => api.get<Payment[]>("/api/payments"), 10000);

  const markPaid = (orderId: string) =>
    api.post(`/api/payments/${orderId}/mark-paid`).then(() => location.reload());

  return (
    <MenuPage
      eyebrow="Management / Payments"
      title="Payment verification"
      actions={
        <button onClick={() => api.post("/api/payments/expire-due").then(() => location.reload())}>
          Run expiry check
        </button>
      }
    >
      <div className="panel table-panel">
        <DataState error={error} loading={!payments} empty={!payments?.length}>
          <div className="table-scroll">
            <table className="data-table">
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
        </DataState>
      </div>
    </MenuPage>
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
    <MenuPage eyebrow="Management / Notifications" title="Notifications">
      <div className="panel">
        <DataState error={error} loading={!data} empty={!data?.length}>
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
        </DataState>
      </div>
    </MenuPage>
  );
}

function Products() {
  const { data: products, error } = usePoll(() => api.get<Product[]>("/api/products"), 10000);

  const update = (id: string, patch: Partial<Product>) =>
    api.patch(`/api/products/${id}`, patch).then(() => location.reload());

  return (
    <MenuPage eyebrow="Management / Catalog" title="Products & stock">
      <div className="panel table-panel">
        <DataState error={error} loading={!products} empty={!products?.length}>
          <div className="table-scroll">
            <table className="data-table">
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
        </DataState>
      </div>
    </MenuPage>
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
    <MenuPage eyebrow="Settings / Content" title="Knowledge base">
      <div className="panel">
        <div className="row form-row">
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
        <DataState error={error} loading={!docs} empty={!docs?.length}>
          <div className="table-scroll">
            <table className="data-table">
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
        </DataState>
      </div>
    </MenuPage>
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
    <MenuPage eyebrow="Customers / Support" title="Human handover">
      <div className="panel">
        <div className="row form-row">
          <input
            placeholder="Conversation ID"
            value={convId}
            onChange={(e) => setConvId(e.target.value)}
          />
          <input placeholder="Alasan" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button onClick={create}>Buat Handover</button>
        </div>
        <DataState error={error} loading={!handovers} empty={!handovers?.length}>
          <div className="table-scroll">
            <table className="data-table">
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
        </DataState>
      </div>
    </MenuPage>
  );
}

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "assistant", label: "Assistant" },
  { id: "whatsapp", label: "WhatsApp" },
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
    dashboard: <AdminDashboard />,
    assistant: <AssistantPlayground />,
    whatsapp: <WhatsApp />,
    orders: <Orders />,
    payments: <Payments />,
    notifications: <Notifications />,
    products: <Products />,
    knowledge: <Knowledge />,
    handover: <Handover />,
  };

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="workspace-switcher">
          <span className="workspace-mark">S</span>
          <span>
            <small>Workspace</small>
            <strong>Soysu Admin</strong>
          </span>
          <span>⌄</span>
        </div>
        <nav className="side-nav">
          <p>Main Menu</p>
          {TABS.slice(0, 2).map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "side-link active" : "side-link"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
          <p>Management</p>
          {TABS.slice(2, 6).map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "side-link active" : "side-link"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
          <p>Settings</p>
          {TABS.slice(6).map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "side-link active" : "side-link"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="profile-card">
          <span className="avatar">SA</span>
          <span>
            <strong>Admin operator</strong>
            <small>Workspace owner</small>
          </span>
        </div>
      </aside>
      <main className="container">
        <div className="header">
          <div className="breadcrumbs">
            Soysu <span>/</span> <strong>{TABS.find((item) => item.id === tab)?.label}</strong>
          </div>
          <div className="header-actions">
            <label className="global-search">
              ⌕<input placeholder="Search" />
              <kbd>⌘ K</kbd>
            </label>
            <button className="header-button" onClick={() => window.print()}>
              Print
            </button>
            <input
              className="token"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onBlur={() => setToken(tokenInput)}
              placeholder="Admin token"
            />
          </div>
        </div>
        {views[tab]}
      </main>
    </div>
  );
}
