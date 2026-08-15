import { OpenAIClient } from "@anvia/openai";

interface EmbeddingModel {
  embedTexts(texts: string[]): Promise<Array<{ document: string; vector: number[] }>>;
}

export interface Embedder {
  embed(texts: string[]): Promise<number[][]>;
}

export class OpenAIEmbedder implements Embedder {
  private model: EmbeddingModel;

  constructor(client: OpenAIClient, modelName = "text-embedding-3-small") {
    this.model = client.embeddingModel(modelName);
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const docs = await this.model.embedTexts(texts);
    return docs.map((doc) => doc.vector);
  }
}
