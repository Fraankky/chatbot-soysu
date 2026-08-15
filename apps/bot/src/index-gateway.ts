import "dotenv/config";

import { loadKnowledge } from "./context.js";
import { WhatsAppGateway } from "./gateway/baileys.js";
import { createRunner } from "./runner.js";

async function main() {
  await loadKnowledge();
  console.log("Knowledge base loaded.");

  const runner = createRunner(async (text, conversationId) => {
    await gateway.setTyping(conversationId, true);
    await new Promise((r) => setTimeout(r, Math.min(800 + text.length * 8, 2500)));
    await gateway.send({ conversationId, text });
    await gateway.setTyping(conversationId, false);
  });
  await runner.connect();

  const gateway = new WhatsAppGateway(
    (msg) => void runner.handleInbound(msg),
    (qr) => console.log("QR scan:\n", qr),
    () => console.log("WhatsApp connected!"),
  );
  await gateway.connect();

  const shutdown = () => {
    void runner.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

void main();
