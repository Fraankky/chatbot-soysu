import { createDb } from "@soysu/database";
import { kbDocuments, kbDocumentVersions } from "@soysu/database/schema";
import type { Embedder } from "@soysu/rag";
import { PgRAG } from "@soysu/rag";

const KEYWORDS = ["kulkas", "matcha", "bantul", "sweetness", "delivery", "storage", "brown"];

function fakeVec(text: string): number[] {
  const tokens = text.toLowerCase().split(/\s+/);
  const vec = new Array(1536).fill(0);
  for (let i = 0; i < KEYWORDS.length; i++) {
    if (tokens.some((t) => t.includes(KEYWORDS[i]))) vec[i] = 1;
  }
  return vec;
}

class MockEmbedder implements Embedder {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(fakeVec);
  }
}

const db = createDb();
const rag = new PgRAG(db, new MockEmbedder());

await rag.ingest([
  { title: "products", content: "Matcha adalah susu kedelai premium dengan teh hijau." },
  { title: "storage", content: "Simpan di kulkas untuk daya tahan hingga 7 hari." },
  { title: "delivery", content: "Pengiriman instan tersedia di Sleman dan Bantul." },
]);

const hits = await rag.retrieve("berapa lama bisa simpan di kulkas?", 3);
console.log("top hit:", hits[0]?.title, "| score:", hits[0]?.score.toFixed(3));
console.log("hit count:", hits.length);
console.log("active docs:", await rag.countActiveDocs());

await db.delete(kbDocumentVersions);
await db.delete(kbDocuments);
console.log("RAG SMOKE OK");
await db.$client.end();
