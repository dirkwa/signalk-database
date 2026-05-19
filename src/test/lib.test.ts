// SPDX-License-Identifier: Apache-2.0
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  openPluginDb,
  closeAll,
  pluginDbPath,
  isNodeSqliteAvailable,
} from "../lib/db.js";

/**
 * Helper: simulate signalk-server's per-plugin data dir contract.
 * The server creates `{configPath}/plugin-config-data/<pluginId>/` and
 * hands that path to the plugin via `app.getDataDirPath()`. We mirror
 * that here without needing a real server.
 */
function tmpApp(id = "test-plugin"): { getDataDirPath(): string; dir: string } {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), "signalk-database-test-"));
  const dir = path.join(cfg, "plugin-config-data", id);
  fs.mkdirSync(dir, { recursive: true });
  return {
    dir,
    getDataDirPath() {
      return dir;
    },
  };
}

afterEach(async () => {
  await closeAll();
});

test("openPluginDb throws if node:sqlite unavailable", async () => {
  if (isNodeSqliteAvailable()) {
    assert.equal(isNodeSqliteAvailable(), true);
    return;
  }
  await assert.rejects(() => openPluginDb(tmpApp()));
});

test("openPluginDb creates the file at <dataDir>/db.sqlite", async () => {
  if (!isNodeSqliteAvailable()) return;
  const app = tmpApp("my-plugin");
  await openPluginDb(app);
  assert.equal(pluginDbPath(app), path.join(app.dir, "db.sqlite"));
  assert.ok(fs.existsSync(pluginDbPath(app)));
});

test("openPluginDb returns a cached handle across calls", async () => {
  if (!isNodeSqliteAvailable()) return;
  const app = tmpApp("cached");
  const a = await openPluginDb(app);
  const b = await openPluginDb(app);
  assert.strictEqual(a, b);
});

test("openPluginDb rejects an app without getDataDirPath", async () => {
  if (!isNodeSqliteAvailable()) return;
  await assert.rejects(() => openPluginDb({} as never));
  await assert.rejects(() =>
    openPluginDb({ getDataDirPath: "not-a-fn" } as never),
  );
});

test("PluginDb run/query/transaction round-trip", async () => {
  if (!isNodeSqliteAvailable()) return;
  const db = await openPluginDb(tmpApp("roundtrip"));

  await db.run(
    "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL)",
  );
  const inserted = await db.run("INSERT INTO items (name) VALUES (?), (?)", [
    "alpha",
    "beta",
  ]);
  assert.equal(inserted.changes, 2);

  const rows = await db.query<{ id: number; name: string }>(
    "SELECT id, name FROM items ORDER BY id",
  );
  assert.deepEqual(
    rows.map((r) => ({ id: r.id, name: r.name })),
    [
      { id: 1, name: "alpha" },
      { id: 2, name: "beta" },
    ],
  );

  await db.transaction(async (tx) => {
    await tx.run("INSERT INTO items (name) VALUES (?)", ["gamma"]);
  });
  let count = await db.query<{ c: number }>("SELECT COUNT(*) AS c FROM items");
  assert.equal(count[0].c, 3);

  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.run("INSERT INTO items (name) VALUES (?)", ["delta"]);
      throw new Error("rollback please");
    }),
  );
  count = await db.query<{ c: number }>("SELECT COUNT(*) AS c FROM items");
  assert.equal(count[0].c, 3, "rollback discarded the failed insert");
});

test("migrate applies pending versions in order and is idempotent", async () => {
  if (!isNodeSqliteAvailable()) return;
  const db = await openPluginDb(tmpApp("migrations"));

  await db.migrate([
    { version: 1, sql: "CREATE TABLE t (a INTEGER)" },
    { version: 2, sql: "ALTER TABLE t ADD COLUMN b TEXT" },
  ]);
  await db.migrate([
    { version: 1, sql: "CREATE TABLE t (a INTEGER)" }, // already applied
    { version: 2, sql: "ALTER TABLE t ADD COLUMN b TEXT" },
    { version: 3, sql: "CREATE INDEX t_a ON t(a)" },
  ]);

  const rows = await db.query<{ version: number }>(
    "SELECT version FROM _migrations ORDER BY version",
  );
  assert.deepEqual(
    rows.map((r) => r.version),
    [1, 2, 3],
  );
});
