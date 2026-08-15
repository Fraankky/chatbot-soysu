import assert from "node:assert/strict";
import { after, test } from "node:test";

import { eq } from "drizzle-orm";

import {
  addToCart,
  checkout,
  clearCart,
  createDb,
  ensureConversation,
  expireDuePayments,
  getOrder,
  markPaid,
  releaseReservation,
} from "@soysu/database";
import {
  carts,
  conversations,
  orders,
  payments,
  products,
  stockReservations,
} from "@soysu/database/schema";

const db = createDb();
const externalId = `test:${process.pid}:${Date.now()}`;

after(async () => {
  await db.$client.end();
});

async function cleanup() {
  const convs = await db
    .select()
    .from(conversations)
    .where(eq(conversations.externalId, externalId));
  for (const c of convs) {
    await db.delete(carts).where(eq(carts.conversationId, c.id));
    const ords = await db.select().from(orders).where(eq(orders.conversationId, c.id));
    for (const o of ords) {
      await db.delete(stockReservations).where(eq(stockReservations.orderId, o.id));
      await db.delete(payments).where(eq(payments.orderId, o.id));
      await db.delete(orders).where(eq(orders.id, o.id));
    }
    await db.delete(conversations).where(eq(conversations.id, c.id));
  }
}

test("checkout reserves stock, markPaid processes, order snapshot correct", async () => {
  await cleanup();
  const conv = await ensureConversation(db, "whatsapp", externalId, "Tester");

  const before = (await db.select().from(products).where(eq(products.id, "soysu-001")))[0];
  await addToCart(db, conv.id, "soysu-001", 2, "Normal");
  const order = await checkout(db, {
    conversationId: conv.id,
    paymentMethod: "bank_transfer",
    deliveryArea: "Sleman",
  });

  const after = (await db.select().from(products).where(eq(products.id, "soysu-001")))[0];
  assert.equal(after.stock, before.stock - 2, "stock should be reserved (decremented)");

  assert.equal(order.status, "pending_confirmation");
  assert.equal(order.paymentStatus, "pending");
  assert.equal(order.items[0].qty, 2);
  assert.equal(order.items[0].unitPrice, before.price, "price snapshot taken");
  assert.equal(order.total, before.price * 2 + order.shippingCost);

  await markPaid(db, order.id, "admin");
  const paid = await getOrder(db, order.id);
  assert.equal(paid?.status, "processing");
  assert.equal(paid?.paymentStatus, "paid");

  const reservations = await db
    .select()
    .from(stockReservations)
    .where(eq(stockReservations.orderId, order.id));
  assert.equal(reservations.length, 0, "reservations converted on payment");

  await cleanup();
});

test("releaseReservation restores stock", async () => {
  await cleanup();
  const conv = await ensureConversation(db, "whatsapp", externalId, "Tester");

  const before = (await db.select().from(products).where(eq(products.id, "soysu-003")))[0];
  await addToCart(db, conv.id, "soysu-003", 1, "Less Sugar");
  const order = await checkout(db, { conversationId: conv.id, paymentMethod: "bank_transfer" });

  const mid = (await db.select().from(products).where(eq(products.id, "soysu-003")))[0];
  assert.equal(mid.stock, before.stock - 1);

  await releaseReservation(db, order.id);
  const after = (await db.select().from(products).where(eq(products.id, "soysu-003")))[0];
  assert.equal(after.stock, before.stock, "stock restored after release");

  await cleanup();
});

test("expireDuePayments cancels order and releases stock", async () => {
  await cleanup();
  const conv = await ensureConversation(db, "whatsapp", externalId, "Tester");

  const before = (await db.select().from(products).where(eq(products.id, "soysu-002")))[0];
  await addToCart(db, conv.id, "soysu-002", 1, "Less Sugar");
  const order = await checkout(db, { conversationId: conv.id, paymentMethod: "bank_transfer" });

  await db
    .update(payments)
    .set({ expiredAt: new Date(Date.now() - 1000) })
    .where(eq(payments.orderId, order.id));

  const expired = await expireDuePayments(db);
  assert.equal(expired, 1);

  const after = await getOrder(db, order.id);
  assert.equal(after?.status, "cancelled");
  assert.equal(after?.paymentStatus, "expired");

  const stock = (await db.select().from(products).where(eq(products.id, "soysu-002")))[0];
  assert.equal(stock.stock, before.stock, "stock released after expiry");

  await clearCart(db, conv.id);
  await cleanup();
});
