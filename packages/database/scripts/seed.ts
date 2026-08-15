import { createDb } from "../src/client.js";
import { products } from "../src/schema.js";
import { SEED_PRODUCTS } from "@soysu/shared";

const db = createDb();

for (const p of SEED_PRODUCTS) {
  await db
    .insert(products)
    .values({ ...p, sweetnessOptions: p.sweetnessOptions })
    .onConflictDoUpdate({
      target: products.id,
      set: {
        name: p.name,
        flavor: p.flavor,
        sweetnessOptions: p.sweetnessOptions,
        price: p.price,
        stock: p.stock,
      },
    });
}
console.log(`Seeded ${SEED_PRODUCTS.length} products`);
await db.$client.end();
