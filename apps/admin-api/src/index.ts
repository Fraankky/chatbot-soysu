import "dotenv/config";

import { serve } from "@hono/node-server";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

import { createDb } from "@soysu/database";
import {
  assignHandover,
  confirmCodOrder,
  conversationsAnalytics,
  createHandover,
  dashboardSummary,
  expireDuePayments,
  getOrder,
  knowledgeAnalytics,
  listHandovers,
  listMessages,
  listNotifications,
  listOrders,
  listPendingPayments,
  markNotificationRead,
  markPaid,
  resolveHandover,
  setOrderStatus,
} from "@soysu/database";
import { kbDocuments, products } from "@soysu/database/schema";
import type { OrderStatus } from "@soysu/shared";

const db = createDb();
const app = new Hono();

app.use("/api/*", cors());

const adminToken = process.env.ADMIN_TOKEN ?? "dev-token";
app.use("/api/*", async (c, next) => {
  const auth = c.req.header("authorization");
  if (auth !== `Bearer ${adminToken}`) return c.json({ error: "unauthorized" }, 401);
  await next();
});

app.get("/health", (c) => c.json({ ok: true }));

app.get("/api/dashboard/summary", async (c) => c.json(await dashboardSummary(db)));

const productSchema = z.object({
  name: z.string().min(1),
  flavor: z.string().min(1),
  sweetnessOptions: z.array(z.string()).default(["Normal"]),
  price: z.number().int().positive(),
  stock: z.number().int().min(0).default(0),
});

app.get("/api/products", async (c) =>
  c.json(await db.select().from(products).orderBy(products.id)),
);

app.post("/api/products", async (c) => {
  const parsed = productSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const [row] = await db
    .insert(products)
    .values({ id: `soysu-${Date.now().toString(36)}`, ...parsed.data })
    .returning();
  return c.json(row, 201);
});

app.patch("/api/products/:id", async (c) => {
  const parsed = productSchema.partial().safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const [row] = await db
    .update(products)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(products.id, c.req.param("id")))
    .returning();
  if (!row) return c.json({ error: "product not found" }, 404);
  return c.json(row);
});

app.delete("/api/products/:id", async (c) => {
  const [row] = await db
    .delete(products)
    .where(eq(products.id, c.req.param("id")))
    .returning();
  if (!row) return c.json({ error: "product not found" }, 404);
  return c.json(row);
});

app.get("/api/orders", async (c) =>
  c.json(await listOrders(db, c.req.query("status") as OrderStatus)),
);

app.get("/api/orders/:id", async (c) => {
  const order = await getOrder(db, c.req.param("id"));
  if (!order) return c.json({ error: "order not found" }, 404);
  return c.json(order);
});

app.patch("/api/orders/:id/status", async (c) => {
  const parsed = z
    .object({
      status: z.enum([
        "processing",
        "ready_to_deliver",
        "out_for_delivery",
        "completed",
        "cancelled",
      ]),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  return c.json(await setOrderStatus(db, c.req.param("id"), parsed.data.status));
});

app.post("/api/orders/:id/confirm-cod", async (c) =>
  c.json(await confirmCodOrder(db, c.req.param("id"))),
);

app.get("/api/payments", async (c) => c.json(await listPendingPayments(db)));

app.post("/api/payments/:orderId/mark-paid", async (c) => {
  await markPaid(db, c.req.param("orderId"), c.req.header("x-admin-id") ?? "admin");
  return c.json({ ok: true });
});

app.post("/api/payments/expire-due", async (c) => c.json({ expired: await expireDuePayments(db) }));

app.get("/api/notifications", async (c) =>
  c.json(await listNotifications(db, c.req.query("unread") === "1")),
);

app.post("/api/notifications/:id/read", async (c) => {
  await markNotificationRead(db, c.req.param("id"));
  return c.json({ ok: true });
});

app.get("/api/knowledge", async (c) =>
  c.json(await db.select().from(kbDocuments).orderBy(kbDocuments.createdAt)),
);

app.post("/api/knowledge", async (c) => {
  const parsed = z
    .object({ title: z.string().min(1), category: z.string().default("general") })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  const [row] = await db.insert(kbDocuments).values(parsed.data).returning();
  return c.json(row, 201);
});

app.delete("/api/knowledge/:id", async (c) => {
  const [row] = await db
    .delete(kbDocuments)
    .where(eq(kbDocuments.id, c.req.param("id")))
    .returning();
  if (!row) return c.json({ error: "document not found" }, 404);
  return c.json(row);
});

app.get("/api/conversations/:id/messages", async (c) =>
  c.json(await listMessages(db, c.req.param("id"))),
);

app.get("/api/handovers", async (c) => c.json(await listHandovers(db)));

app.post("/api/handovers", async (c) => {
  const parsed = z
    .object({ conversationId: z.string().min(1), reason: z.string() })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
  return c.json(await createHandover(db, parsed.data.conversationId, parsed.data.reason), 201);
});

app.post("/api/handovers/:id/assign", async (c) =>
  c.json(await assignHandover(db, c.req.param("id"), c.req.header("x-admin-id") ?? "admin")),
);

app.post("/api/handovers/:id/resolve", async (c) =>
  c.json(await resolveHandover(db, c.req.param("id"), c.req.header("x-admin-id") ?? "admin")),
);

app.get("/api/analytics/conversations", async (c) => {
  const to = new Date(c.req.query("to") ?? Date.now());
  const from = new Date(c.req.query("from") ?? to.getTime() - 7 * 86400_000);
  return c.json(await conversationsAnalytics(db, from, to));
});

app.get("/api/analytics/knowledge", async (c) => {
  const to = new Date(c.req.query("to") ?? Date.now());
  const from = new Date(c.req.query("from") ?? to.getTime() - 7 * 86400_000);
  return c.json(await knowledgeAnalytics(db, from, to));
});

const port = Number(process.env.PORT ?? 8787);

setInterval(() => {
  void expireDuePayments(db).catch((err) => console.error("expire check failed:", err));
}, 60_000);

serve({ fetch: app.fetch, port }, (info) =>
  console.log(`Admin API running on http://localhost:${info.port}`),
);
