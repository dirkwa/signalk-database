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

function tmpConfigPath(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "signalk-database-test-"));
}

function appWith(configPath: string) {
  return { config: { configPath } };
}

afterEach(async () => {
  await closeAll();
});

test("openPluginDb throws if node:sqlite unavailable", async () => {
  if (isNodeSqliteAvailable()) {
    assert.equal(isNodeSqliteAvailable(), true);
    return;
  }
  await assert.rejects(() =>
    openPluginDb(appWith(tmpConfigPath()), "test-plugin"),
  );
});

test("openPluginDb creates the directory and file", async () => {
  if (!isNodeSqliteAvailable()) return;
  const cfg = tmpConfigPath();
  await openPluginDb(appWith(cfg), "test-plugin");
  assert.ok(fs.existsSync(path.join(cfg, "plugin-db")));
  assert.ok(fs.existsSync(pluginDbPath(cfg, "test-plugin")));
});

test("openPluginDb returns a cached handle across calls", async () => {
  if (!isNodeSqliteAvailable()) return;
  const cfg = tmpConfigPath();
  const a = await openPluginDb(appWith(cfg), "cached");
  const b = await openPluginDb(appWith(cfg), "cached");
  assert.strictEqual(a, b);
});

test("openPluginDb rejects missing or empty configPath", async () => {
  if (!isNodeSqliteAvailable()) return;
  await assert.rejects(() => openPluginDb({ config: { configPath: "" } }, "x"));
  await assert.rejects(() => openPluginDb({} as never, "x"));
});

test("openPluginDb rejects suspicious plugin ids", async () => {
  if (!isNodeSqliteAvailable()) return;
  const cfg = tmpConfigPath();
  await assert.rejects(() => openPluginDb(appWith(cfg), "../escape"));
  await assert.rejects(() => openPluginDb(appWith(cfg), "with spaces"));
  await assert.rejects(() => openPluginDb(appWith(cfg), ""));
});

test("PluginDb run/query/transaction round-trip", async () => {
  if (!isNodeSqliteAvailable()) return;
  const db = await openPluginDb(appWith(tmpConfigPath()), "roundtrip");

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
  const db = await openPluginDb(appWith(tmpConfigPath()), "migrations");

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
