import { OpenAIClient } from "@anvia/openai";

const client = new OpenAIClient({
  apiKey: process.env.OPENAI_API_KEY,
});

export const model = client.completionModel(process.env.OPENAI_MODEL ?? "gpt-5");
