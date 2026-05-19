// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { PluginDbInfo } from "../lib/types.js";

const require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DatabaseSync = any;

let SqliteDatabase: (new (path: string) => DatabaseSync) | undefined;
try {
  const sqlite = require("node:sqlite");
  SqliteDatabase = sqlite.DatabaseSync;
} catch {
  // node:sqlite not available — Registry construction will throw
}

/**
 * File-scan based registry. Looks at `{configPath}/plugin-db/*.db` to
 * enumerate every plugin database, regardless of whether any plugin has
 * opened a handle to it in this process. Used only by the admin UI; the
 * library-side openPluginDb() in src/lib/db.ts is independent of this.
 */
export class Registry {
  private dbDir: string;
  private roHandles: Map<string, DatabaseSync> = new Map();

  constructor(configPath: string) {
    if (!SqliteDatabase) {
      throw new Error(
        "signalk-database: node:sqlite is not available — requires Node.js 22.5.0 or newer",
      );
    }
    this.dbDir = path.join(configPath, "plugin-db");
    fs.mkdirSync(this.dbDir, { recursive: true });
  }

  list(): PluginDbInfo[] {
    const entries: PluginDbInfo[] = [];
    let names: string[];
    try {
      names = fs.readdirSync(this.dbDir);
    } catch {
      return [];
    }
    for (const name of names) {
      if (!name.endsWith(".db")) continue;
      const id = name.slice(0, -3);
      if (!/^[A-Za-z0-9._-]+$/.test(id)) continue;
      const full = path.join(this.dbDir, name);
      try {
        const stat = fs.statSync(full);
        entries.push({
          id,
          path: full,
          sizeBytes: stat.size,
          modifiedAt: stat.mtime.toISOString(),
        });
      } catch {
        // ignore unreadable files
      }
    }
    entries.sort((a, b) => a.id.localeCompare(b.id));
    return entries;
  }

  /**
   * Open or return a cached read-only handle for the given DB id.
   * Returns undefined if no such file exists.
   */
  getReadOnly(id: string): DatabaseSync | undefined {
    if (!/^[A-Za-z0-9._-]+$/.test(id)) return undefined;
    const cached = this.roHandles.get(id);
    if (cached) return cached;

    const full = path.join(this.dbDir, `${id}.db`);
    if (!fs.existsSync(full)) return undefined;

    const db = new SqliteDatabase!(full);
    db.exec("PRAGMA query_only = ON");
    this.roHandles.set(id, db);
    return db;
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
