import { eq } from "drizzle-orm";

import { createDb, ensureConversation } from "@soysu/database";
import {
  addToCart,
  attachPaymentProof,
  checkout,
  clearCart,
  expireDuePayments,
  getOrder,
  listOrders,
  listPendingPayments,
  markPaid,
} from "@soysu/database";
import { carts, conversations, orders, payments } from "@soysu/database/schema";

const db = createDb();
const externalId = `smoke-${Date.now()}`;

async function cleanup() {
  const convs = await db
    .select()
    .from(conversations)
    .where(eq(conversations.externalId, externalId));
  for (const c of convs) {
    await db.delete(carts).where(eq(carts.conversationId, c.id));
    const ords = await db.select().from(orders).where(eq(orders.conversationId, c.id));
    for (const o of ords) {
      await db.delete(payments).where(eq(payments.orderId, o.id));
      await db.delete(orders).where(eq(orders.id, o.id));
    }
    await db.delete(conversations).where(eq(conversations.id, c.id));
  }
}

await cleanup();
const conv = await ensureConversation(db, "whatsapp", externalId, "Smoke Tester");

await addToCart(db, conv.id, "soysu-002", 2, "Less Sugar");
await addToCart(db, conv.id, "soysu-001", 1, "Normal");

const order = await checkout(db, {
  conversationId: conv.id,
  customerName: "Smoke Tester",
  deliveryArea: "Sleman",
  paymentMethod: "bank_transfer",
});
console.log("order created:", order.id, "| status:", order.status, "| total:", order.total);
console.log("items:", order.items.map((i) => `${i.flavor}x${i.qty}`).join(", "));
console.log("payment status:", order.paymentStatus);

await attachPaymentProof(db, order.id, "msg-1");
console.log("pending payments:", (await listPendingPayments(db)).length);

await markPaid(db, order.id, "admin-1");
const paid = await getOrder(db, order.id);
console.log("after markPaid:", paid?.status, paid?.paymentStatus);

await clearCart(db, conv.id);
await cleanup();
console.log("SMOKE OK");
await db.$client.end();
