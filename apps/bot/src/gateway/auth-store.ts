import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import {
  BufferJSON,
  initAuthCreds,
  makeCacheableSignalKeyStore,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import type { DB } from "@soysu/database";
import { waAuthSessions } from "@soysu/database/schema";

const connectionId = "default";

function encryptionKey(): Buffer {
  const key = Buffer.from(process.env.WA_AUTH_ENCRYPTION_KEY ?? "", "base64");
  if (key.length !== 32) throw new Error("WA_AUTH_ENCRYPTION_KEY harus base64 32-byte");
  return key;
}

function encrypt(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value, BufferJSON.replacer)),
    cipher.final(),
  ]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${data.toString("base64")}`;
}

function decrypt<T>(value: string): T {
  const [iv, tag, data] = value.split(".").map((part) => Buffer.from(part, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(data), decipher.final()]).toString(),
    BufferJSON.reviver,
  ) as T;
}

export async function createDatabaseAuthState(db: DB): Promise<AuthenticationState> {
  const load = async <T>(id: string): Promise<T | undefined> => {
    const [row] = await db
      .select()
      .from(waAuthSessions)
      .where(eq(waAuthSessions.id, `${connectionId}:${id}`));
    return row ? decrypt<T>((row.data as { encrypted: string }).encrypted) : undefined;
  };
  const save = async (id: string, value: unknown) => {
    await db
      .insert(waAuthSessions)
      .values({
        id: `${connectionId}:${id}`,
        data: { encrypted: encrypt(value) },
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: waAuthSessions.id,
        set: { data: { encrypted: encrypt(value) }, updatedAt: new Date() },
      });
  };
  const creds = (await load<AuthenticationState["creds"]>("creds")) ?? initAuthCreds();
  const keys = makeCacheableSignalKeyStore({
    get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
      const result: Partial<Record<string, SignalDataTypeMap[T]>> = {};
      for (const id of ids) {
        const value = await load<SignalDataTypeMap[T]>(`key:${type}:${id}`);
        if (value) result[id] = value;
      }
      return result as { [id: string]: SignalDataTypeMap[T] };
    },
    set: async (data: SignalDataSet) => {
      for (const [type, values] of Object.entries(data)) {
        for (const [id, value] of Object.entries(values ?? {})) {
          if (value) await save(`key:${type}:${id}`, value);
        }
      }
    },
  });
  return { creds, keys };
}

export async function clearDatabaseAuthState(db: DB): Promise<void> {
  await db.delete(waAuthSessions).where(eq(waAuthSessions.id, `${connectionId}:creds`));
  const rows = await db.select({ id: waAuthSessions.id }).from(waAuthSessions);
  for (const row of rows.filter((item) => item.id.startsWith(`${connectionId}:key:`))) {
    await db.delete(waAuthSessions).where(eq(waAuthSessions.id, row.id));
  }
}

export async function saveDatabaseAuthCreds(
  db: DB,
  creds: AuthenticationState["creds"],
): Promise<void> {
  await db
    .insert(waAuthSessions)
    .values({
      id: `${connectionId}:creds`,
      data: { encrypted: encrypt(creds) },
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: waAuthSessions.id,
      set: { data: { encrypted: encrypt(creds) }, updatedAt: new Date() },
    });
}
