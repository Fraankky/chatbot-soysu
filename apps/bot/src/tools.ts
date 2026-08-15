import { createTool } from "@anvia/core";
import { SEED_PRODUCTS } from "@soysu/shared";
import { z } from "zod";

import { rag } from "./rag.js";

export const getCurrentTime = createTool({
  name: "get_current_time",
  description: "Get the current time for a timezone.",
  input: z.object({
    timezone: z.string().optional().describe("IANA timezone, e.g. Asia/Jakarta"),
  }),
  async execute({ timezone }) {
    return new Date().toLocaleString("en-US", {
      timeZone: timezone,
      dateStyle: "full",
      timeStyle: "short",
    });
  },
});

export const checkStock = createTool({
  name: "check_stock",
  description: "Check current price and stock of a soy milk flavor.",
  input: z.object({
    flavor: z.string().describe("Flavor name, e.g. Matcha, Original, Brown Sugar"),
  }),
  async execute({ flavor }) {
    const product = SEED_PRODUCTS.find((p) =>
      p.flavor.toLowerCase().includes(flavor.toLowerCase()),
    );
    if (!product) return `No product found for "${flavor}".`;
    return (
      `${product.name} - Rp ${product.price}, stock ${product.stock} pcs. ` +
      `Sweetness options: ${product.sweetnessOptions.join(", ")}`
    );
  },
});

export const ragSearch = createTool({
  name: "rag_search",
  description:
    "Search the knowledge base for info about products, ingredients, storage, and delivery.",
  input: z.object({
    query: z.string(),
  }),
  async execute({ query }) {
    const hits = await rag.retrieve(query, 3);
    if (hits.length === 0) return "No relevant info found in the knowledge base.";
    return hits.map((hit) => `[${hit.chunk.title}] ${hit.chunk.content}`).join("\n\n");
  },
});
