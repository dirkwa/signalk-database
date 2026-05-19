// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { Migration, PluginDb, RunResult } from "./types.js";

const require = createRequire(import.meta.url);

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

/**
 * The portion of the SignalK plugin app object that we need. We use the
 * server-provided `getDataDirPath()` so the database lives under the
 * plugin's standard data dir (`{configPath}/plugin-config-data/<id>/`)
 * — no direct access to `app.config.configPath`.
 */
interface AppLike {
  getDataDirPath(): string;
}

const DB_FILENAME = "db.sqlite";

const cache: Map<string, PluginDb> = new Map();
const rawCache: Map<string, DatabaseSync> = new Map();

/** Path the library writes to for a given app. Exported for tests + tooling. */
export function pluginDbPath(app: AppLike): string {
  return path.join(app.getDataDirPath(), DB_FILENAME);
}

/**
 * Opens (or returns the cached) PluginDb for the calling plugin. The DB
 * lives at `{configPath}/plugin-config-data/<pluginId>/db.sqlite`, which
 * the server's `app.getDataDirPath()` creates and isolates per plugin —
 * a plugin cannot reach another plugin's data through this API.
 *
 * Safe to call from any plugin at any time. `signalk-database` does not
 * need to be started for this to work.
 */
export async function openPluginDb(app: AppLike): Promise<PluginDb> {
  if (!SqliteDatabase) {
    throw new Error(
      "signalk-database: node:sqlite is not available — requires Node.js 22.5.0 or newer",
    );
  }
  if (typeof app?.getDataDirPath !== "function") {
    throw new Error(
      "signalk-database: app.getDataDirPath is not a function — pass the SignalK plugin app object",
    );
  }
  const dbDir = app.getDataDirPath();
  const dbPath = path.join(dbDir, DB_FILENAME);

  const hit = cache.get(dbPath);
  if (hit) return hit;

  fs.mkdirSync(dbDir, { recursive: true });

  const db = new SqliteDatabase!(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );

  rawCache.set(dbPath, db);
  const handle = wrap(db);
  cache.set(dbPath, handle);
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
