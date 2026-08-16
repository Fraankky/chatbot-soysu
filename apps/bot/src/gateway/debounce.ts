import { createRedis } from "@soysu/database";

export interface DebouncedMessages {
  conversationId: string;
  messages: string[];
  burstId: string;
}

const KEY = (conv: string) => `soysu:debounce:${conv}`;
const CLAIM_KEY = (conv: string) => `soysu:debounce:${conv}:claim`;
const WINDOW_MS = 5000;

export class Debouncer {
  private redis = createRedis();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private onBurst: (burst: DebouncedMessages) => Promise<void>) {}

  async connect(): Promise<void> {
    await this.redis.connect();
  }

  async quit(): Promise<void> {
    for (const t of this.timers.values()) clearTimeout(t);
    await this.redis.quit();
  }

  async push(conversationId: string, text: string): Promise<void> {
    await this.redis.lpush(KEY(conversationId), text);
    await this.redis.expire(KEY(conversationId), Math.ceil(WINDOW_MS / 1000) + 10);

    // reset sliding window timer
    const existing = this.timers.get(conversationId);
    if (existing) clearTimeout(existing);
    this.timers.set(
      conversationId,
      setTimeout(() => {
        this.timers.delete(conversationId);
        void this.process(conversationId).catch((error) => {
          console.error("debounced message failed", error);
        });
      }, WINDOW_MS),
    );
  }

  async process(conversationId: string): Promise<void> {
    // atomic claim to avoid double processing across restarts
    const claimed = await this.redis.set(
      CLAIM_KEY(conversationId),
      "1",
      "EX",
      Math.ceil(WINDOW_MS / 1000),
    );
    if (!claimed) return;

    const items = await this.redis.lrange(KEY(conversationId), 0, -1);
    await this.redis.del(KEY(conversationId));
    if (items.length === 0) return;

    await this.onBurst({
      conversationId,
      messages: items.reverse(),
      burstId: `${conversationId}:${Date.now()}`,
    });
  }
}
