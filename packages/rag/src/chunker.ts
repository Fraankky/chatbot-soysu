import { randomUUID } from "node:crypto";

export interface Chunk {
  id: string;
  parentId: string;
  title: string;
  content: string;
}

export function chunkText(title: string, text: string, maxSize = 800): Chunk[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: Chunk[] = [];
  let buffer = "";
  let parentId = randomUUID();

  for (const paragraph of paragraphs) {
    if (buffer.length + paragraph.length > maxSize && buffer) {
      chunks.push({ id: randomUUID(), parentId, title, content: buffer });
      parentId = randomUUID();
      buffer = "";
    }
    buffer += buffer ? "\n\n" + paragraph : paragraph;
  }

  if (buffer) {
    chunks.push({ id: randomUUID(), parentId, title, content: buffer });
  }

  return chunks;
}
