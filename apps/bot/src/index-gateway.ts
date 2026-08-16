import "dotenv/config";

import { createRedis } from "@soysu/database";
import { z } from "zod";
import { loadKnowledge } from "./context.js";
import { db } from "./context.js";
import { WhatsAppGateway } from "./gateway/baileys.js";
import { createRunner } from "./runner.js";

async function main() {
  const runner = createRunner(async (text, conversationId) => {
    await gateway.setTyping(conversationId, true);
    await new Promise((r) => setTimeout(r, Math.min(800 + text.length * 8, 2500)));
    await gateway.send({ conversationId, text });
    await gateway.setTyping(conversationId, false);
  });
  await runner.connect();

  const gateway = new WhatsAppGateway(
    db,
    (msg) => void runner.handleInbound(msg),
    (qr) => console.log("QR scan:\n", qr),
    () => console.log("WhatsApp connected!"),
  );
  await gateway.start();
  const playgroundRedis = createRedis();
  await playgroundRedis.connect();
  void listenPlayground(playgroundRedis, runner);

  try {
    await loadKnowledge();
    console.log("Knowledge base loaded.");
  } catch (error) {
    console.error("Knowledge base gagal dimuat; WhatsApp tetap berjalan.", error);
  }

  const shutdown = () => {
    void gateway.stop();
    void runner.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const playgroundRequestSchema = z.object({
  requestId: z.string().uuid(),
  conversationId: z.string().min(1).max(120),
  text: z.string().min(1).max(2000),
});

async function listenPlayground(
  redis: ReturnType<typeof createRedis>,
  runner: ReturnType<typeof createRunner>,
): Promise<void> {
  while (true) {
    const item = await redis.brpop("soysu:playground:requests", 0);
    if (!item) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(item[1]);
    } catch {
      continue;
    }
    const parsed = playgroundRequestSchema.safeParse(payload);
    if (!parsed.success) continue;
    const responseKey = `soysu:playground:response:${parsed.data.requestId}`;
    try {
      const text = await runner.handlePlayground(parsed.data.conversationId, parsed.data.text);
      await redis.lpush(responseKey, JSON.stringify({ ok: true, text }));
      await redis.expire(responseKey, 60);
    } catch (error) {
      await redis.lpush(
        responseKey,
        JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "Bot error" }),
      );
      await redis.expire(responseKey, 60);
    }
  }
}

void main();
