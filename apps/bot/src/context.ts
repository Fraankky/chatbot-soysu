import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { OpenAIClient } from "@anvia/openai";
import { createDb } from "@soysu/database";
import type { DB } from "@soysu/database";
import { OpenAIEmbedder, PgRAG } from "@soysu/rag";

export const db: DB = createDb();

const client = new OpenAIClient({ apiKey: process.env.OPENAI_API_KEY });
export const rag = new PgRAG(db, new OpenAIEmbedder(client));

const knowledgeDir = join(dirname(fileURLToPath(import.meta.url)), "..", "knowledge");

export async function loadKnowledge(): Promise<void> {
  const files = ["products.md", "storage.md", "delivery.md"];
  const docs = await Promise.all(
    files.map(async (file) => ({
      title: file.replace(".md", ""),
      content: await readFile(join(knowledgeDir, file), "utf8"),
    })),
  );
  await rag.ingest(docs);
}
