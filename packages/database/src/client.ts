import "dotenv/config";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

export function createDb(url = process.env.DATABASE_URL) {
  const client = postgres(url ?? "postgres://soysu:soysu@localhost:5433/soysu", { prepare: false });
  return drizzle(client, { schema });
}

export type DB = ReturnType<typeof createDb>;
