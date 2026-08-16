import makeWASocket, {
  Browsers,
  DisconnectReason,
  jidDecode,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import type { DB } from "@soysu/database";
import { createRedis, updateWhatsAppConnection } from "@soysu/database";
import type { InboundMessage, OutboundMessage } from "@soysu/shared";
import {
  clearDatabaseAuthState,
  createDatabaseAuthState,
  saveDatabaseAuthCreds,
} from "./auth-store.js";

const CONNECTION_ID = "default";
const QR_KEY = `whatsapp:qr:${CONNECTION_ID}`;
const COMMAND_KEY = `whatsapp:command:${CONNECTION_ID}`;
type GatewayStatus = "not_paired" | "qr_ready" | "connecting" | "connected" | "disconnected";

export class WhatsAppGateway {
  private sock: WASocket | null = null;
  private connecting = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private stopping = false;
  private status: GatewayStatus = "not_paired";
  private readonly allowSelfMessages = process.env.WA_ALLOW_SELF_MESSAGES === "true";
  private readonly sentMessageIds = new Set<string>();
  private redis = createRedis();

  constructor(
    private db: DB,
    private onMessage: (msg: InboundMessage) => void,
    private onQr: (qr: string) => void,
    private onReady: () => void,
  ) {}

  async start(): Promise<void> {
    await this.redis.connect();
    void this.listenCommands();
    await this.connect();
  }

  async connect(): Promise<void> {
    if (this.stopping) return;
    if (this.connecting) return;
    if (this.sock) {
      if (this.status !== "qr_ready" || (await this.redis.exists(QR_KEY)) === 1) return;
      this.sock.ws.close();
      this.sock = null;
    }
    this.connecting = true;
    this.status = "connecting";
    await updateWhatsAppConnection(this.db, CONNECTION_ID, "connecting", { lastError: null });
    try {
      const auth = await createDatabaseAuthState(this.db);
      const sock = makeWASocket({
        auth,
        browser: Browsers.ubuntu("Chrome"),
        syncFullHistory: false,
        markOnlineOnConnect: true,
      });
      this.sock = sock;
      this.connecting = false;

      sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
          void (async () => {
            await this.redis.set(QR_KEY, qr, "EX", 120);
            this.status = "qr_ready";
            await updateWhatsAppConnection(this.db, CONNECTION_ID, "qr_ready", {
              lastQrAt: new Date(),
              lastError: null,
            });
          })();
          this.onQr(qr);
        }
        if (connection === "open") {
          this.status = "connected";
          void this.redis.del(QR_KEY);
          void updateWhatsAppConnection(this.db, CONNECTION_ID, "connected", {
            phoneNumber: sock.user?.id?.split(":")[0] ?? null,
            deviceName: sock.user?.name ?? null,
            connectedAt: new Date(),
            lastSeenAt: new Date(),
            lastError: null,
          });
          this.onReady();
        }
        if (connection === "close") {
          this.sock = null;
          const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output
            ?.statusCode;
          const loggedOut = statusCode === DisconnectReason.loggedOut;
          this.status = loggedOut ? "not_paired" : "disconnected";
          void updateWhatsAppConnection(
            this.db,
            CONNECTION_ID,
            loggedOut ? "not_paired" : "disconnected",
            {
              lastError: statusCode
                ? `WhatsApp disconnected (${statusCode})`
                : "WhatsApp disconnected",
              lastSeenAt: new Date(),
            },
          );
          if (!loggedOut && !this.stopping) this.scheduleReconnect();
        }
      });

      sock.ev.on("creds.update", () => void saveDatabaseAuthCreds(this.db, auth.creds));
      sock.ev.on("messages.upsert", ({ messages, type }) => {
        if (type !== "notify") return;
        for (const message of messages) {
          const inbound = this.normalize(message);
          if (inbound) this.onMessage(inbound);
        }
      });
    } catch (error) {
      this.connecting = false;
      await updateWhatsAppConnection(this.db, CONNECTION_ID, "disconnected", {
        lastError: error instanceof Error ? error.message : "WhatsApp connection failed",
        lastSeenAt: new Date(),
      });
      throw error;
    }
  }

  async unpair(): Promise<void> {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.sock?.ws.close();
    this.sock = null;
    await clearDatabaseAuthState(this.db);
    await this.redis.del(QR_KEY);
    await updateWhatsAppConnection(this.db, CONNECTION_ID, "not_paired", {
      phoneNumber: null,
      deviceName: null,
      connectedAt: null,
      lastError: null,
    });
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.sock?.ws.close();
    this.sock = null;
    await this.redis.quit();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, 3000);
  }

  private async listenCommands(): Promise<void> {
    while (!this.stopping) {
      const result = await this.redis.brpop(COMMAND_KEY, 0);
      const command = result?.[1];
      if (command === "connect") await this.connect();
      if (command === "unpair") await this.unpair();
    }
  }

  private normalize(m: WAMessage): InboundMessage | null {
    const remote = m.key?.remoteJidAlt ?? m.key?.remoteJid;
    if (!remote || remote.endsWith("@g.us") || remote === "status@broadcast") return null;
    if (
      m.key?.fromMe &&
      (!this.allowSelfMessages || !m.key.id || this.sentMessageIds.has(m.key.id))
    )
      return null;
    const text = m.message?.conversation ?? m.message?.extendedTextMessage?.text;
    if (!text || !m.key?.id) return null;
    return {
      channel: "whatsapp",
      externalMessageId: m.key.id,
      conversationId: remote,
      senderId: remote,
      text,
      mediaType: m.message?.imageMessage ? "image" : m.message?.documentMessage ? "document" : null,
      receivedAt: new Date(Number(m.messageTimestamp ?? Date.now() / 1000) * 1000),
    };
  }

  async send(message: OutboundMessage): Promise<void> {
    if (!this.sock) return;
    const content = message.mediaBuffer
      ? { image: message.mediaBuffer, caption: message.text }
      : { text: message.text };
    const sent = await this.sock.sendMessage(message.conversationId, content);
    if (sent?.key.id) {
      this.sentMessageIds.add(sent.key.id);
      setTimeout(() => this.sentMessageIds.delete(sent.key.id as string), 60_000);
    }
  }

  async setTyping(conversationId: string, typing: boolean): Promise<void> {
    if (!this.sock || !jidDecode(conversationId)) return;
    try {
      await this.sock.sendPresenceUpdate(typing ? "composing" : "paused", conversationId);
    } catch (error) {
      console.warn("typing indicator skipped", error);
    }
  }
}
