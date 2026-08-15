import "dotenv/config";

import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

import { ensureConversation, saveMessage } from "@soysu/database";

import { createAgent } from "./agent.js";
import { db, loadKnowledge } from "./context.js";

const conversationId = "cli:local";
const conv = await ensureConversation(db, "whatsapp", conversationId, "CLI User");

await loadKnowledge();
console.log("Knowledge base loaded.\n");

const agent = createAgent(conv.id);

const rl = createInterface({ input: stdin, output: stdout });
console.log('Soysu chatbot siap. Ketik "exit" untuk keluar.\n');

while (true) {
  const input = await rl.question("Kamu: ");
  const message = input.trim();
  if (message.toLowerCase() === "exit") break;
  if (message === "") continue;

  await saveMessage(db, conv.id, "user", message);
  const response = await agent.prompt(message).send();
  await saveMessage(db, conv.id, "bot", response.output);
  console.log(`\nBot: ${response.output}\n`);
}

rl.close();
console.log("Sampai jumpa!");
