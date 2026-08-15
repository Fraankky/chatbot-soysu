import type { Chunk } from "./chunker.js";

export interface RetrievedChunk {
  chunk: Chunk;
  score: number;
}

interface Entry {
  chunk: Chunk;
  vector: number[];
  tokens: Map<string, number>;
}

export class VectorStore {
  private entries: Entry[] = [];

  add(chunks: Chunk[], vectors: number[][]): void {
    for (let i = 0; i < chunks.length; i++) {
      this.entries.push({
        chunk: chunks[i],
        vector: vectors[i],
        tokens: tokenize(chunks[i].content),
      });
    }
  }

  search(vector: number[], query: string, k: number): RetrievedChunk[] {
    const queryTokens = tokenize(query);
    const scored = this.entries.map((entry) => ({
      chunk: entry.chunk,
      score: 0.7 * cosine(vector, entry.vector) + 0.3 * overlap(queryTokens, entry.tokens),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function overlap(query: Map<string, number>, doc: Map<string, number>): number {
  let shared = 0;
  let total = 0;
  for (const [token, count] of query) {
    total += count;
    if (doc.has(token)) shared += Math.min(count, doc.get(token)!);
  }
  return total === 0 ? 0 : shared / total;
}

function tokenize(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (token.length < 2) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}
