import { serve } from "@hono/node-server";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { createDb } from "@soysu/database";
import { orders, products } from "@soysu/database/schema";

const db = createDb();
const app = new Hono();

app.use("/api/*", cors());

app.get("/health", (c) => c.json({ ok: true }));

const productSchema = z.object({
  name: z.string().min(1),
  flavor: z.string().min(1),
  sweetnessOptions: z.array(z.string()).default(["Normal"]),
  price: z.number().int().positive(),
  stock: z.number().int().min(0).default(0),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  flavor: z.string().min(1).optional(),
  sweetnessOptions: z.array(z.string()).optional(),
  price: z.number().int().positive().optional(),
  stock: z.number().int().min(0).optional(),
});

app.get("/api/products", async (c) => {
  const rows = await db.select().from(products).orderBy(products.id);
  return c.json(rows);
});

app.post("/api/products", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = productSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);

  const id = `soysu-${String((await db.select().from(products)).length + 1).padStart(3, "0")}`;
  const [row] = await db
    .insert(products)
    .values({ id, ...parsed.data })
    .returning();
  return c.json(row, 201);
});

app.patch("/api/products/:id", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
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

app.get("/api/orders", async (c) => {
  const rows = await db.select().from(orders).orderBy(orders.createdAt);
  return c.json(rows);
});

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) =>
  console.log(`Admin API running on http://localhost:${info.port}`),
);
