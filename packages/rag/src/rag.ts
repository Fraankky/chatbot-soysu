import type { Embedder } from "./embedder.js";
import { chunkText } from "./chunker.js";
import type { RetrievedChunk } from "./store.js";
import { VectorStore } from "./store.js";

export interface RAGDoc {
  title: string;
  content: string;
}

export class RAG {
  private store = new VectorStore();

  constructor(private embedder: Embedder) {}

  async ingest(docs: RAGDoc[]): Promise<void> {
    const chunks = docs.flatMap((doc) => chunkText(doc.title, doc.content));
    const vectors = await this.embedder.embed(chunks.map((chunk) => chunk.content));
    this.store.add(chunks, vectors);
  }

  async retrieve(query: string, k = 3): Promise<RetrievedChunk[]> {
    const [vector] = await this.embedder.embed([query]);
    return this.store.search(vector, query, k);
  }
}
