// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Migration, PluginDb, RunResult } from "./types.js";

const require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DatabaseSync = any;

let SqliteDatabase: (new (path: string) => DatabaseSync) | undefined;
try {
  const sqlite = require("node:sqlite");
  SqliteDatabase = sqlite.DatabaseSync;
} catch {
  // node:sqlite not available — openPluginDb will throw a clear error
}

export function isNodeSqliteAvailable(): boolean {
  return SqliteDatabase !== undefined;
}

interface AppLike {
  config?: { configPath?: string };
}

const cache: Map<string, PluginDb> = new Map();
const rawCache: Map<string, DatabaseSync> = new Map();

function cacheKey(configPath: string, pluginId: string): string {
  return `${configPath}::${pluginId}`;
}

export function pluginDbPath(configPath: string, pluginId: string): string {
  return path.join(configPath, "plugin-db", `${pluginId}.db`);
}

/**
 * Opens (or returns the cached) PluginDb for the given plugin id under
 * the signalk-server's configPath. Safe to call from any plugin at any
 * time — `signalk-database` does not need to be started for this to work.
 */
export async function openPluginDb(
  app: AppLike,
  pluginId: string,
): Promise<PluginDb> {
  if (!SqliteDatabase) {
    throw new Error(
      "signalk-database: node:sqlite is not available — requires Node.js 22.5.0 or newer",
    );
  }
  const configPath = app.config?.configPath;
  if (typeof configPath !== "string" || configPath.length === 0) {
    throw new Error(
      "signalk-database: app.config.configPath is missing or empty",
    );
  }
  if (!/^[A-Za-z0-9._-]+$/.test(pluginId)) {
    throw new Error(`signalk-database: invalid pluginId: ${pluginId}`);
  }

  const key = cacheKey(configPath, pluginId);
  const hit = cache.get(key);
  if (hit) return hit;

  const dbDir = path.join(configPath, "plugin-db");
  fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = pluginDbPath(configPath, pluginId);

  const db = new SqliteDatabase!(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );

  rawCache.set(key, db);
  const handle = wrap(db);
  cache.set(key, handle);
  return handle;
}

/** Close all cached handles. Intended for tests and process shutdown. */
export async function closeAll(): Promise<void> {
  for (const db of rawCache.values()) {
    try {
      db.close();
    } catch {
      // best effort
    }
  }
  rawCache.clear();
  cache.clear();
}

function queryAll<T>(db: DatabaseSync, sql: string, params?: unknown[]): T[] {
  const stmt = db.prepare(sql);
  return params && params.length > 0 ? stmt.all(...params) : stmt.all();
}

function runStmt(db: DatabaseSync, sql: string, params?: unknown[]): RunResult {
  const stmt = db.prepare(sql);
  const result = params && params.length > 0 ? stmt.run(...params) : stmt.run();
  return {
    changes: result.changes,
    lastInsertRowid: result.lastInsertRowid,
  };
}

function wrap(db: DatabaseSync): PluginDb {
  const handle: PluginDb = {
    async migrate(migrations: Migration[]): Promise<void> {
      const applied = new Set(
        queryAll<{ version: number }>(
          db,
          "SELECT version FROM _migrations",
        ).map((r) => r.version),
      );
      const sorted = [...migrations].sort((a, b) => a.version - b.version);
      for (const m of sorted) {
        if (applied.has(m.version)) continue;
        db.exec(m.sql);
        db.prepare(
          "INSERT INTO _migrations (version, applied_at) VALUES (?, ?)",
        ).run(m.version, new Date().toISOString());
      }
    },

    async query<T = Record<string, unknown>>(
      sql: string,
      params?: unknown[],
    ): Promise<T[]> {
      return queryAll<T>(db, sql, params);
    },

    async run(sql: string, params?: unknown[]): Promise<RunResult> {
      return runStmt(db, sql, params);
    },

    async transaction<T>(fn: (tx: PluginDb) => Promise<T>): Promise<T> {
      db.exec("BEGIN");
      try {
        const result = await fn(handle);
        db.exec("COMMIT");
        return result;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  };
  return handle;
}
