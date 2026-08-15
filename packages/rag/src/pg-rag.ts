import { and, eq, sql } from "drizzle-orm";

import type { DB } from "@soysu/database";
import { kbChildChunks, kbDocumentVersions, kbDocuments, kbParents } from "@soysu/database/schema";

import type { Embedder } from "./embedder.js";
import { chunkText } from "./chunker.js";

export interface RAGDoc {
  title: string;
  content: string;
}

export interface RetrievedContext {
  title: string;
  content: string;
  score: number;
}

const DENSE_WEIGHT = 0.7;
const SPARSE_WEIGHT = 0.3;
const CONFIDENCE_THRESHOLD = 0.15;

export class PgRAG {
  constructor(
    private db: DB,
    private embedder: Embedder,
    private embeddingModel = "text-embedding-3-small",
    private dimensions = 1536,
  ) {}

  async ingest(docs: RAGDoc[]): Promise<void> {
    for (const doc of docs) {
      const chunks = chunkText(doc.title, doc.content);
      const vectors = await this.embedder.embed(chunks.map((c) => c.content));

      const [document] = await this.db
        .insert(kbDocuments)
        .values({ title: doc.title })
        .onConflictDoNothing({ target: kbDocuments.title })
        .returning();

      let documentId = document?.id;
      if (!documentId) {
        const [existing] = await this.db
          .select()
          .from(kbDocuments)
          .where(eq(kbDocuments.title, doc.title));
        documentId = existing.id;
      }

      const [version] = await this.db
        .insert(kbDocumentVersions)
        .values({
          documentId,
          content: doc.content,
          embeddingModel: this.embeddingModel,
          embeddingDimensions: this.dimensions,
        })
        .returning();

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const [parent] = await this.db
          .insert(kbParents)
          .values({ documentVersionId: version.id, title: chunk.title, content: chunk.content })
          .returning();
        await this.db.insert(kbChildChunks).values({
          parentId: parent.id,
          content: chunk.content,
          embedding: vectors[i],
          embeddingModel: this.embeddingModel,
        });
      }

      await this.db
        .update(kbDocuments)
        .set({ status: "active", activeVersionId: version.id })
        .where(eq(kbDocuments.id, documentId));
    }
  }

  async retrieve(query: string, k = 3): Promise<RetrievedContext[]> {
    const [vector] = await this.embedder.embed([query]);
    const vecLiteral = `[${vector.join(",")}]`;

    const rows = await this.db.execute<{
      title: string;
      content: string;
      dense: number;
      sparse: number;
      combined: number;
    }>(sql`
      SELECT
        p.title AS title,
        c.content AS content,
        1 - (c.embedding <=> ${vecLiteral}::vector) AS dense,
        similarity(c.content, ${query}) AS sparse,
        ${DENSE_WEIGHT} * (1 - (c.embedding <=> ${vecLiteral}::vector))
          + ${SPARSE_WEIGHT} * similarity(c.content, ${query}) AS combined
      FROM kb_child_chunks c
      JOIN kb_parents p ON p.id = c.parent_id
      ORDER BY combined DESC
      LIMIT ${k}
    `);

    return rows
      .map((row) => ({
        title: row.title,
        content: row.content,
        score: row.combined,
      }))
      .filter((row) => row.score >= CONFIDENCE_THRESHOLD);
  }

  async countActiveDocs(): Promise<number> {
    const rows = await this.db
      .select()
      .from(kbDocuments)
      .where(and(eq(kbDocuments.status, "active")));
    return rows.length;
  }
}
