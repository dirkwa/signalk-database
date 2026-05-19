// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { PluginDbInfo } from "../lib/types.js";

const require = createRequire(import.meta.url);

type DatabaseSync = any;

let SqliteDatabase: (new (path: string) => DatabaseSync) | undefined;
try {
  const sqlite = require("node:sqlite");
  SqliteDatabase = sqlite.DatabaseSync;
} catch {
  // node:sqlite not available — Registry construction will throw
}

const DB_FILENAME = "db.sqlite";
const ID_RE = /^[A-Za-z0-9._-]+$/;

/**
 * File-scan based registry. Walks `{configPath}/plugin-config-data/<pluginId>/db.sqlite`
 * to enumerate every plugin database, regardless of whether any plugin
 * has opened a handle to it in this process. Used only by the admin UI;
 * the library-side openPluginDb() in src/lib/db.ts is independent of this.
 *
 * The root is derived from `path.dirname(app.getDataDirPath())` — the
 * plugin doesn't access `app.config.configPath` directly. This is the only
 * place in signalk-database that reaches across plugin scopes, which is
 * appropriate for the admin/inspector role.
 */
export class Registry {
  private rootDir: string;
  private roHandles: Map<string, DatabaseSync> = new Map();

  constructor(parentDir: string) {
    if (!SqliteDatabase) {
      throw new Error(
        "signalk-database: node:sqlite is not available — requires Node.js 22.5.0 or newer",
      );
    }
    this.rootDir = parentDir;
  }

  list(): PluginDbInfo[] {
    const entries: PluginDbInfo[] = [];
    let names: string[];
    try {
      names = fs.readdirSync(this.rootDir);
    } catch {
      return [];
    }
    for (const id of names) {
      if (!ID_RE.test(id)) continue;
      const dbPath = path.join(this.rootDir, id, DB_FILENAME);
      try {
        const stat = fs.statSync(dbPath);
        if (!stat.isFile()) continue;
        entries.push({
          id,
          path: dbPath,
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      } catch {
        // not a plugin with a db — skip silently
      }
    }
    entries.sort((a, b) => a.id.localeCompare(b.id));
    return entries;
  }

  /**
   * Open or return a cached read-only handle for the given plugin id.
   * Returns undefined if the plugin has no `db.sqlite` in its data dir.
   */
  getReadOnly(id: string): DatabaseSync | undefined {
    if (!ID_RE.test(id)) return undefined;
    const cached = this.roHandles.get(id);
    if (cached) return cached;

    const dbPath = path.join(this.rootDir, id, DB_FILENAME);
    let stat;
    try {
      stat = fs.statSync(dbPath);
    } catch {
      return undefined; // file missing or unreadable
    }
    if (!stat.isFile()) return undefined; // dir or symlink-to-dir at that path

    try {
      const db = new SqliteDatabase!(dbPath);
      db.exec("PRAGMA query_only = ON");
      this.roHandles.set(id, db);
      return db;
    } catch {
      // corrupt file, locked, permission denied — treat as not openable.
      // Returning undefined lets routes respond 404 instead of leaking
      // an internal sqlite error to the HTTP layer.
      return undefined;
    }
  }

  /**
   * Produce a consistent point-in-time copy of the given plugin's DB at
   * `destPath` via `VACUUM INTO`. Safe to call against a live DB: VACUUM
   * INTO acquires a brief read lock on the source, walks every page, and
   * writes a defragmented copy to the destination. The source plugin
   * keeps running.
   *
   * The destination must not already exist (SQLite refuses to overwrite).
   * Opens its own fresh writeable connection because `PRAGMA query_only`
   * on the cached `getReadOnly` handle blocks VACUUM INTO.
   *
   * Throws if the id is invalid or the source has no `db.sqlite`. The
   * caller (routes.ts) maps these to 404. Any sqlite error from the
   * VACUUM itself also throws — the caller maps to 500.
   */
  vacuumInto(id: string, destPath: string): void {
    if (!ID_RE.test(id)) {
      throw new Error(`invalid id: ${id}`);
    }
    const srcPath = path.join(this.rootDir, id, DB_FILENAME);
    let stat;
    try {
      stat = fs.statSync(srcPath);
    } catch {
      throw new Error(`database not found: ${id}`);
    }
    if (!stat.isFile()) {
      throw new Error(`database not found: ${id}`);
    }
    // SQLite refuses VACUUM INTO if the destination exists.
    if (fs.existsSync(destPath)) {
      throw new Error(`destination already exists: ${destPath}`);
    }

    const db = new SqliteDatabase!(srcPath);
    try {
      // node:sqlite doesn't have a parameter-binding form for VACUUM, so
      // we manually escape the path (only single quotes can be ambiguous
      // inside a SQL string literal). The destPath is constructed by our
      // own route handler from os.tmpdir() + a server-generated name,
      // never from user input — so this is belt-and-braces.
      const escaped = destPath.replace(/'/g, "''");
      db.exec(`VACUUM INTO '${escaped}'`);
    } finally {
      db.close();
    }
  }

  close(): void {
    for (const db of this.roHandles.values()) {
      try {
        db.close();
      } catch {
        // best effort
      }
    }
    this.roHandles.clear();
  }
}
