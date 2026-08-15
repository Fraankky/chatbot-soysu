import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import makeWASocket, {
  Browsers,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import type { InboundMessage, OutboundMessage } from "@soysu/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = join(__dirname, "..", "..", "auth");

// ponytail: file-based auth state; swap to wa_auth_sessions (Postgres) when
// multi-instance/scale requires it
export class WhatsAppGateway {
  private sock: WASocket | null = null;

  constructor(
    private onMessage: (msg: InboundMessage) => void,
    private onQr: (qr: string) => void,
    private onReady: () => void,
  ) {}

  async connect(): Promise<void> {
    mkdirSync(AUTH_DIR, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const sock = makeWASocket({
      auth: state,
      browser: Browsers.ubuntu("Chrome"),
      syncFullHistory: false,
      markOnlineOnConnect: true,
    });
    this.sock = sock;

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) this.onQr(qr);
      if (connection === "open") this.onReady();
      if (connection === "close") {
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output
          ?.statusCode;
        const shouldReconnect = statusCode !== 401;
        console.log("WhatsApp disconnected", { statusCode, reconnecting: shouldReconnect });
        if (shouldReconnect) setTimeout(() => void this.connect(), 3000);
      }
    });

    sock.ev.on("creds.update", () => void saveCreds());

    sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify") return;
      for (const m of messages) {
        const inbound = this.normalize(m);
        if (inbound) this.onMessage(inbound);
      }
    });
  }

  private normalize(m: any): InboundMessage | null {
    const remote = m.key?.remoteJid as string | undefined;
    if (!remote) return null;
    if (remote.endsWith("@g.us") || remote === "status@broadcast") return null; // ignore groups
    if (m.key?.fromMe) return null; // ignore own messages

    const msg = m.message?.conversation ?? m.message?.extendedTextMessage?.text;
    if (!msg) return null;

    return {
      channel: "whatsapp",
      externalMessageId: m.key.id as string,
      conversationId: remote,
      senderId: remote,
      text: msg,
      mediaType: m.message?.imageMessage ? "image" : m.message?.documentMessage ? "document" : null,
      receivedAt: new Date(m.messageTimestamp ?? Date.now()),
    };
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!this.sock) return;
    const content = message.mediaBuffer
      ? { image: message.mediaBuffer, caption: message.text }
      : { text: message.text };
    await this.sock.sendMessage(message.conversationId, content as any);
  }

  async setTyping(conversationId: string, typing: boolean): Promise<void> {
    if (!this.sock) return;
    await this.sock.sendPresenceUpdate(typing ? "composing" : "paused", conversationId);
  }
}
