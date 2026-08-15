import { and, eq, sql } from "drizzle-orm";
import type { DB } from "./client.js";
import {
  cartItems,
  carts,
  conversations,
  customers,
  handoverEvents,
  handovers,
  messages,
  notifications,
  orderItems,
  orders,
  payments,
  products,
  ragEvents,
  stockMovements,
  stockReservations,
} from "./schema.js";
import type { HandoverStatus, OrderStatus, PaymentMethod, PaymentStatus } from "@soysu/shared";

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
type DbLike = DB | Tx;

export const PAYMENT_TTL_MINUTES = 30;

function orderNumber(): string {
  return `ORD-${Date.now().toString(36).toUpperCase()}`;
}

async function ensureCustomer(
  db: DbLike,
  channel: "whatsapp" | "telegram",
  externalId: string,
  name?: string,
) {
  const [existing] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.channel, channel), eq(customers.externalId, externalId)));
  if (existing) return existing;
  const [created] = await db.insert(customers).values({ channel, externalId, name }).returning();
  return created;
}

export async function ensureConversation(
  db: DbLike,
  channel: "whatsapp" | "telegram",
  externalId: string,
  senderName?: string,
) {
  const [existing] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.channel, channel), eq(conversations.externalId, externalId)));
  if (existing) return existing;
  const customer = await ensureCustomer(db, channel, externalId, senderName);
  const [created] = await db
    .insert(conversations)
    .values({ channel, externalId, customerId: customer.id })
    .returning();
  return created;
}

export async function saveMessage(
  db: DbLike,
  conversationId: string,
  role: "user" | "bot" | "human",
  text: string,
  mediaType?: string | null,
  providerMessageId?: string,
) {
  const [row] = await db
    .insert(messages)
    .values({ conversationId, role, text, mediaType, providerMessageId })
    .onConflictDoNothing({ target: messages.providerMessageId })
    .returning();
  await db
    .update(conversations)
    .set({ lastMessageAt: new Date() })
    .where(eq(conversations.id, conversationId));
  return row;
}

export async function getCart(db: DbLike, conversationId: string) {
  const [cart] = await db.select().from(carts).where(eq(carts.conversationId, conversationId));
  if (cart) return cart;
  const [created] = await db.insert(carts).values({ conversationId }).returning();
  return created;
}

export async function listCartItems(db: DbLike, cartId: string) {
  return db
    .select({
      product: products,
      qty: cartItems.qty,
      sweetnessLevel: cartItems.sweetnessLevel,
    })
    .from(cartItems)
    .innerJoin(products, eq(cartItems.productId, products.id))
    .where(eq(cartItems.cartId, cartId));
}

export async function addToCart(
  db: DbLike,
  conversationId: string,
  productId: string,
  qty: number,
  sweetnessLevel: string,
) {
  const cart = await getCart(db, conversationId);
  const product = await db.select().from(products).where(eq(products.id, productId)).limit(1);
  if (!product[0]) throw new Error(`Produk ${productId} tidak ditemukan`);
  if (!product[0].sweetnessOptions.includes(sweetnessLevel)) {
    throw new Error(`Tingkat manis "${sweetnessLevel}" tidak tersedia`);
  }
  await db
    .insert(cartItems)
    .values({ cartId: cart.id, productId, qty, sweetnessLevel })
    .onConflictDoUpdate({
      target: [cartItems.cartId, cartItems.productId],
      set: { qty: sql`${cartItems.qty} + excluded.qty`, sweetnessLevel },
    });
  return listCartItems(db, cart.id);
}

export async function updateCartItem(
  db: DbLike,
  conversationId: string,
  productId: string,
  qty: number,
  sweetnessLevel: string,
) {
  const cart = await getCart(db, conversationId);
  await db
    .update(cartItems)
    .set({ qty, sweetnessLevel })
    .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.productId, productId)));
  return listCartItems(db, cart.id);
}

export async function removeCartItem(db: DbLike, conversationId: string, productId: string) {
  const cart = await getCart(db, conversationId);
  await db
    .delete(cartItems)
    .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.productId, productId)));
  return listCartItems(db, cart.id);
}

export async function clearCart(db: DbLike, conversationId: string) {
  const cart = await getCart(db, conversationId);
  await db.delete(cartItems).where(eq(cartItems.cartId, cart.id));
}

async function reserveStock(
  db: DbLike,
  orderId: string,
  items: Array<{ productId: string; qty: number }>,
) {
  for (const item of items) {
    const [row] = await db
      .select()
      .from(products)
      .where(eq(products.id, item.productId))
      .for("update");
    if (!row) throw new Error(`Produk ${item.productId} tidak ditemukan`);
    if (row.stock < item.qty) throw new Error(`Stok ${row.flavor} tidak cukup (sisa ${row.stock})`);
    await db
      .update(products)
      .set({ stock: row.stock - item.qty, updatedAt: new Date() })
      .where(eq(products.id, item.productId));
    await db
      .insert(stockReservations)
      .values({ orderId, productId: item.productId, qty: item.qty });
    await db
      .insert(stockMovements)
      .values({ productId: item.productId, delta: -item.qty, reason: "reserve", orderId });
  }
}

export async function releaseReservation(db: DbLike, orderId: string) {
  const reservations = await db
    .select()
    .from(stockReservations)
    .where(
      and(eq(stockReservations.orderId, orderId), sql`${stockReservations.releasedAt} IS NULL`),
    );
  for (const res of reservations) {
    await db
      .update(products)
      .set({ stock: sql`${products.stock} + ${res.qty}`, updatedAt: new Date() })
      .where(eq(products.id, res.productId));
    await db
      .update(stockReservations)
      .set({ releasedAt: new Date() })
      .where(eq(stockReservations.id, res.id));
    await db
      .insert(stockMovements)
      .values({ productId: res.productId, delta: res.qty, reason: "release", orderId });
  }
}

export interface CheckoutInput {
  conversationId: string;
  customerName?: string;
  deliveryArea?: string;
  deliveryAddress?: string;
  paymentMethod: PaymentMethod;
}

export async function checkout(db: DbLike, input: CheckoutInput) {
  const cart = await getCart(db, input.conversationId);
  const items = await listCartItems(db, cart.id);
  if (items.length === 0) throw new Error("Keranjang kosong");

  const shippingCost = 8000;
  const orderId = orderNumber();
  const total = items.reduce((sum, i) => sum + i.product.price * i.qty, 0) + shippingCost;

  const paymentStatus: PaymentStatus = input.paymentMethod === "cod" ? "not_required" : "pending";

  await db.transaction(async (tx) => {
    await reserveStock(
      tx,
      orderId,
      items.map((i) => ({ productId: i.product.id, qty: i.qty })),
    );
    await tx.insert(orders).values({
      id: orderId,
      conversationId: input.conversationId,
      customerName: input.customerName,
      paymentMethod: input.paymentMethod,
      paymentStatus,
      status: "pending_confirmation",
      deliveryArea: input.deliveryArea,
      deliveryAddress: input.deliveryAddress,
      shippingCost,
      total,
    });
    await tx.insert(orderItems).values(
      items.map((i) => ({
        orderId,
        productId: i.product.id,
        flavor: i.product.flavor,
        name: i.product.name,
        sweetnessLevel: i.sweetnessLevel,
        qty: i.qty,
        unitPrice: i.product.price,
      })),
    );
    await tx.insert(payments).values({
      orderId,
      method: input.paymentMethod,
      amount: total,
      status: paymentStatus,
      expiredAt:
        paymentStatus === "pending" ? new Date(Date.now() + PAYMENT_TTL_MINUTES * 60_000) : null,
    });
  });

  await createNotification(db, {
    type: "new_order",
    orderId,
    conversationId: input.conversationId,
    title: "Order baru",
    message: `Order ${orderId} menunggu diproses (${input.paymentMethod})`,
  });

  const order = await getOrder(db, orderId);
  if (!order) throw new Error("Order gagal dibuat");
  return order;
}

export async function getOrder(db: DbLike, orderId: string) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return null;
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  return { ...order, items };
}

export async function listOrders(db: DbLike, status?: OrderStatus) {
  const rows = status
    ? await db.select().from(orders).where(eq(orders.status, status)).orderBy(orders.createdAt)
    : await db.select().from(orders).orderBy(orders.createdAt);
  return Promise.all(
    rows.map(async (o) => ({
      ...o,
      items: await db.select().from(orderItems).where(eq(orderItems.orderId, o.id)),
    })),
  );
}

export async function setOrderStatus(db: DbLike, orderId: string, status: OrderStatus) {
  const [row] = await db.update(orders).set({ status }).where(eq(orders.id, orderId)).returning();
  if (!row) throw new Error("Order tidak ditemukan");
  return row;
}

export async function confirmCodOrder(db: DbLike, orderId: string) {
  const [row] = await db
    .update(orders)
    .set({ status: "processing", paymentStatus: "not_required" })
    .where(and(eq(orders.id, orderId), eq(orders.paymentMethod, "cod")))
    .returning();
  if (!row) throw new Error("Order tidak ditemukan atau bukan COD");
  return row;
}

export async function markPaid(db: DbLike, orderId: string, adminId: string) {
  await db.transaction(async (tx) => {
    await tx
      .update(payments)
      .set({ status: "paid", verifiedBy: adminId, verifiedAt: new Date() })
      .where(and(eq(payments.orderId, orderId), eq(payments.status, "pending")));
    await tx
      .update(orders)
      .set({ status: "processing", paymentStatus: "paid" })
      .where(eq(orders.id, orderId));
    await tx
      .delete(stockReservations)
      .where(
        and(eq(stockReservations.orderId, orderId), sql`${stockReservations.releasedAt} IS NULL`),
      );
  });
  await createNotification(db, {
    type: "payment_paid",
    orderId,
    title: "Pembayaran diterima",
    message: `Order ${orderId} sudah dibayar, masuk ke proses`,
  });
}

export async function expirePayment(db: DbLike, orderId: string) {
  await db.transaction(async (tx) => {
    await tx
      .update(payments)
      .set({ status: "expired" })
      .where(and(eq(payments.orderId, orderId), eq(payments.status, "pending")));
    await tx
      .update(orders)
      .set({ status: "cancelled", paymentStatus: "expired" })
      .where(eq(orders.id, orderId));
    await releaseReservation(tx, orderId);
  });
  await createNotification(db, {
    type: "payment_expired",
    orderId,
    title: "Pembayaran kedaluwarsa",
    message: `Order ${orderId} dibatalkan karena pembayaran tidak selesai`,
  });
}

export async function expireDuePayments(db: DB) {
  const due = await db
    .select()
    .from(payments)
    .where(and(eq(payments.status, "pending"), sql`${payments.expiredAt} < NOW()`));
  for (const p of due) {
    await expirePayment(db, p.orderId);
  }
  return due.length;
}

export async function listPendingPayments(db: DB) {
  return db
    .select()
    .from(payments)
    .where(eq(payments.status, "pending"))
    .orderBy(payments.createdAt);
}

export async function attachPaymentProof(
  db: DbLike,
  orderId: string,
  proofMessageId: string,
  proofFilePath?: string,
) {
  await db
    .update(payments)
    .set({ proofMessageId, proofFilePath })
    .where(and(eq(payments.orderId, orderId), eq(payments.status, "pending")));
  await createNotification(db, {
    type: "payment_proof",
    orderId,
    title: "Bukti pembayaran masuk",
    message: `Order ${orderId}: customer mengirim bukti transfer, mohon diverifikasi`,
  });
}

export async function createNotification(
  db: DbLike,
  n: { type: string; title: string; message: string; orderId?: string; conversationId?: string },
) {
  const [row] = await db.insert(notifications).values(n).returning();
  return row;
}

export async function listNotifications(db: DbLike, unreadOnly = false) {
  const rows = unreadOnly
    ? await db
        .select()
        .from(notifications)
        .where(eq(notifications.isRead, false))
        .orderBy(notifications.createdAt)
    : await db.select().from(notifications).orderBy(notifications.createdAt);
  return rows;
}

export async function markNotificationRead(db: DbLike, id: string) {
  await db.update(notifications).set({ isRead: true }).where(eq(notifications.id, id));
}

export async function listHandovers(db: DbLike, status?: HandoverStatus) {
  const rows = status
    ? await db
        .select()
        .from(handovers)
        .where(eq(handovers.status, status))
        .orderBy(handovers.createdAt)
    : await db.select().from(handovers).orderBy(handovers.createdAt);
  return rows;
}

export async function createHandover(db: DbLike, conversationId: string, reason: string) {
  const [row] = await db.insert(handovers).values({ conversationId, reason }).returning();
  await db
    .update(conversations)
    .set({ botPaused: true })
    .where(eq(conversations.id, conversationId));
  await db.insert(handoverEvents).values({ handoverId: row.id, event: "opened", actor: "system" });
  await createNotification(db, {
    type: "handover_request",
    conversationId,
    title: "Butuh manusia",
    message: `Percakapan meminta handover: ${reason}`,
  });
  return row;
}

export async function assignHandover(db: DbLike, id: string, adminId: string) {
  const [row] = await db
    .update(handovers)
    .set({ status: "assigned", assignedTo: adminId })
    .where(eq(handovers.id, id))
    .returning();
  if (!row) throw new Error("Handover tidak ditemukan");
  await db.insert(handoverEvents).values({ handoverId: id, event: "assigned", actor: adminId });
  return row;
}

export async function resolveHandover(db: DbLike, id: string, adminId: string) {
  const [row] = await db
    .update(handovers)
    .set({ status: "resolved", resolvedAt: new Date() })
    .where(eq(handovers.id, id))
    .returning();
  if (!row) throw new Error("Handover tidak ditemukan");
  await db
    .update(conversations)
    .set({ botPaused: false })
    .where(eq(conversations.id, row.conversationId));
  await db.insert(handoverEvents).values({ handoverId: id, event: "resolved", actor: adminId });
  return row;
}

export async function listMessages(db: DbLike, conversationId: string, limit = 50) {
  return db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(messages.createdAt)
    .limit(limit);
}

export interface ConversationAnalytics {
  daily: Array<{ date: string; count: number }>;
  total: number;
  active: number;
  botMessages: number;
  humanMessages: number;
}

export async function conversationsAnalytics(
  db: DbLike,
  from: Date,
  to: Date,
): Promise<ConversationAnalytics> {
  const daily = await db.execute<{ date: string; count: number }>(sql`
    SELECT to_char(created_at, 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
    FROM messages
    WHERE created_at >= ${from.toISOString()} AND created_at < ${to.toISOString()}
    GROUP BY date ORDER BY date`);
  const totals = await db.execute<{
    total: number;
    active: number;
    bot: number;
    human: number;
  }>(sql`
    SELECT
      (SELECT COUNT(*)::int FROM messages WHERE created_at >= ${from.toISOString()} AND created_at < ${to.toISOString()}) AS total,
      (SELECT COUNT(*)::int FROM conversations) AS active,
      (SELECT COUNT(*)::int FROM messages WHERE role = 'bot' AND created_at >= ${from.toISOString()} AND created_at < ${to.toISOString()}) AS bot,
      (SELECT COUNT(*)::int FROM messages WHERE role = 'human' AND created_at >= ${from.toISOString()} AND created_at < ${to.toISOString()}) AS human`);
  const t = totals[0];
  return {
    daily: daily.map((r) => ({ date: r.date, count: r.count })),
    total: t?.total ?? 0,
    active: t?.active ?? 0,
    botMessages: t?.bot ?? 0,
    humanMessages: t?.human ?? 0,
  };
}

export interface KnowledgeAnalytics {
  queriesPerDay: Array<{ date: string; count: number }>;
  totalQueries: number;
  noAnswerRate: number;
  avgLatencyMs: number;
  activeDocs: number;
  docsByCategory: Array<{ category: string; count: number }>;
}

export async function knowledgeAnalytics(
  db: DbLike,
  from: Date,
  to: Date,
): Promise<KnowledgeAnalytics> {
  const daily = await db.execute<{ date: string; count: number }>(sql`
    SELECT to_char(created_at, 'YYYY-MM-DD') AS date, COUNT(*)::int AS count
    FROM rag_events
    WHERE created_at >= ${from.toISOString()} AND created_at < ${to.toISOString()}
    GROUP BY date ORDER BY date`);
  const stats = await db.execute<{ total: number; noAnswer: number; avg: number }>(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE no_answer)::int AS no_answer,
      COALESCE(AVG(latency_ms), 0)::int AS avg
    FROM rag_events
    WHERE created_at >= ${from.toISOString()} AND created_at < ${to.toISOString()}`);
  const docs = await db.execute<{ category: string; count: number }>(sql`
    SELECT category, COUNT(*)::int AS count FROM kb_documents WHERE status = 'active' GROUP BY category`);
  const s = stats[0];
  return {
    queriesPerDay: daily.map((r) => ({ date: r.date, count: r.count })),
    totalQueries: s?.total ?? 0,
    noAnswerRate: (s?.total ?? 0) > 0 ? (s?.noAnswer ?? 0) / (s?.total ?? 1) : 0,
    avgLatencyMs: s?.avg ?? 0,
    activeDocs: docs.reduce((sum, d) => sum + d.count, 0),
    docsByCategory: docs.map((d) => ({ category: d.category, count: d.count })),
  };
}

export async function recordRagEvent(
  db: DbLike,
  e: {
    conversationId?: string;
    query: string;
    topScore?: number;
    noAnswer?: boolean;
    latencyMs?: number;
  },
) {
  await db.insert(ragEvents).values({
    conversationId: e.conversationId ?? null,
    query: e.query,
    topScore: e.topScore != null ? String(e.topScore) : null,
    noAnswer: e.noAnswer ?? false,
    latencyMs: e.latencyMs ?? null,
  });
}

export async function dashboardSummary(db: DbLike) {
  const today = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count FROM orders WHERE created_at >= date_trunc('day', now())`);
  const revenue = await db.execute<{ sum: number }>(sql`
    SELECT COALESCE(SUM(total), 0)::int AS sum FROM orders
    WHERE payment_status = 'paid' OR status IN ('completed', 'processing')`);
  const pendingPayments = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count FROM payments WHERE status = 'pending'`);
  const lowStock = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count FROM products WHERE stock <= 5`);
  const unread = await db.execute<{ count: number }>(sql`
    SELECT COUNT(*)::int AS count FROM notifications WHERE is_read = false`);
  return {
    ordersToday: today[0]?.count ?? 0,
    revenue: revenue[0]?.sum ?? 0,
    pendingPayments: pendingPayments[0]?.count ?? 0,
    lowStock: lowStock[0]?.count ?? 0,
    unreadNotifications: unread[0]?.count ?? 0,
  };
}
