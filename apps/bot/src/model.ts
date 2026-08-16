import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
  completionApi: "chat",
});

export const model = client.completionModel(process.env.OPENAI_MODEL ?? "gpt-5");
