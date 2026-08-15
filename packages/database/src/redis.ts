import "dotenv/config";

import { Redis } from "ioredis";

export function createRedis(url = process.env.REDIS_URL) {
  return new Redis(url ?? "redis://localhost:6380", { lazyConnect: true, maxRetriesPerRequest: 2 });
}
