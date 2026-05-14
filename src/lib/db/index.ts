import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Neon serverless driver + Drizzle ORM.
 *
 * Uses HTTP queries (not WebSocket) — optimal for Vercel serverless functions
 * where each invocation is short-lived. No connection pooling needed.
 *
 * Lazy-initialized: neon() reads DATABASE_URL on first query, not at import.
 * This lets the bundle build on Vercel before env vars are wired up.
 */
type Db = NeonHttpDatabase<typeof schema>;

let _db: Db | null = null;

function getDb(): Db {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  _db = drizzle(neon(url), { schema });
  return _db;
}

export const db = new Proxy({} as Db, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb(), prop, receiver);
  },
});
