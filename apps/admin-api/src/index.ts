import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { SEED_ORDERS, SEED_PRODUCTS } from "@soysu/shared";
import type { Order, Product } from "@soysu/shared";

const products: Product[] = [...SEED_PRODUCTS];
const orders: Order[] = [...SEED_ORDERS];

const app = new Hono();

app.use("/api/*", cors());

app.get("/health", (c) => c.json({ ok: true }));

app.get("/api/products", (c) => c.json(products));

app.post("/api/products", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.name || !body?.flavor || typeof body.price !== "number") {
    return c.json({ error: "name, flavor, and price are required" }, 400);
  }
  const product: Product = {
    id: `soysu-${String(products.length + 1).padStart(3, "0")}`,
    name: String(body.name),
    flavor: String(body.flavor),
    sweetnessOptions: body.sweetnessOptions ?? ["Normal"],
    price: body.price,
    stock: body.stock ?? 0,
  };
  products.push(product);
  return c.json(product, 201);
});

app.put("/api/products/:id", async (c) => {
  const product = products.find((p) => p.id === c.req.param("id"));
  if (!product) return c.json({ error: "product not found" }, 404);

  const body = await c.req.json().catch(() => null);
  if (typeof body.stock === "number") product.stock = body.stock;
  if (typeof body.price === "number") product.price = body.price;
  return c.json(product);
});

app.delete("/api/products/:id", (c) => {
  const index = products.findIndex((p) => p.id === c.req.param("id"));
  if (index === -1) return c.json({ error: "product not found" }, 404);
  const [removed] = products.splice(index, 1);
  return c.json(removed);
});

app.get("/api/orders", (c) => c.json(orders));

const port = Number(process.env.PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) =>
  console.log(`Admin API running on http://localhost:${info.port}`),
);
