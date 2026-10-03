import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";
import { env } from "@/lib/env";

export type DB = BetterSQLite3Database<typeof schema>;

type GlobalWithDb = typeof globalThis & { __energybotDb?: DB };
const g = globalThis as GlobalWithDb;

/**
 * Singleton SQLite connection (WAL). Runs pending drizzle migrations on first
 * init so a fresh deployment self-migrates. better-sqlite3 is synchronous —
 * fine for this app's scale and removes async plumbing everywhere.
 */
export function getDb(): DB {
  if (g.__energybotDb) return g.__energybotDb;

  const dbPath = path.resolve(process.cwd(), env.databasePath());
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });

  g.__energybotDb = db;
  return db;
}

/** Test helper: build an isolated in-memory database. */
export function makeTestDb(): DB {
  const sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  return db;
}

export { schema };
export function now(): number {
  return Date.now();
}
