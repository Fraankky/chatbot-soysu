import { eq } from "drizzle-orm";

import { ensureConversation, getConversation, saveMessage } from "@soysu/database";
import { conversations } from "@soysu/database/schema";
import type { InboundMessage } from "@soysu/shared";

import { createAgent } from "./agent.js";
import { db } from "./context.js";
import { Debouncer } from "./gateway/debounce.js";

const agents = new Map<string, ReturnType<typeof createAgent>>();

function agentFor(conversationId: string) {
  let agent = agents.get(conversationId);
  if (!agent) {
    agent = createAgent(conversationId);
    agents.set(conversationId, agent);
  }
  return agent;
}

export function createRunner(send: (text: string, conversationId: string) => Promise<void>) {
  const runAgent = async (conversationId: string, prompt: string, saveUser = false) => {
    const conv = await ensureConversation(db, "whatsapp", conversationId);
    const current = await getConversation(db, conv.id);
    if (current?.botPaused) return "Bot sedang di-pause karena handover aktif.";
    if (saveUser) await saveMessage(db, conv.id, "user", prompt);
    const agent = agentFor(conv.id);
    const response = await agent.prompt(prompt).send();
    await saveMessage(db, conv.id, "bot", response.output);
    return response.output;
  };

  const debouncer = new Debouncer(async (burst) => {
    const prompt = burst.messages.join("\n");
    const response = await runAgent(burst.conversationId, prompt);
    await send(response, burst.conversationId);
  });

  const handleInbound = async (msg: InboundMessage) => {
    const conv = await ensureConversation(db, msg.channel, msg.conversationId);
    await saveMessage(db, conv.id, "user", msg.text, msg.mediaType, msg.externalMessageId);
    await debouncer.push(msg.conversationId, msg.text);
  };

  return {
    connect: () => debouncer.connect(),
    close: () => debouncer.quit(),
    handleInbound,
    handlePlayground: (conversationId: string, prompt: string) =>
      runAgent(conversationId, prompt, true),
  };
}

export async function listActiveConversations(): Promise<string[]> {
  const rows = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.status, "active"));
  return rows.map((r) => r.id);
}
