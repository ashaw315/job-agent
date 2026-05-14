import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Neon serverless driver + Drizzle ORM.
 *
 * Uses HTTP queries (not WebSocket) — optimal for Vercel serverless functions
 * where each invocation is short-lived. No connection pooling needed.
 *
 * Environment variable: DATABASE_URL (Neon connection string)
 */
const sql = neon(process.env.DATABASE_URL!);

export const db = drizzle(sql, { schema });
