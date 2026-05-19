// SPDX-License-Identifier: Apache-2.0
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Registry } from "../plugin/registry.js";
import { openPluginDb, closeAll, isNodeSqliteAvailable } from "../lib/db.js";

function tmpConfigPath(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "signalk-database-test-"));
}

afterEach(async () => {
  await closeAll();
});

test("Registry.list returns DBs discovered on disk, sorted", async () => {
  if (!isNodeSqliteAvailable()) return;
  const cfg = tmpConfigPath();
  await openPluginDb({ config: { configPath: cfg } }, "beta");
  await openPluginDb({ config: { configPath: cfg } }, "alpha");

  const registry = new Registry(cfg);
  const list = registry.list();
  assert.deepEqual(
    list.map((d) => d.id),
    ["alpha", "beta"],
  );
  assert.ok(list.every((d) => d.sizeBytes >= 0));
  registry.close();
});

test("Registry.list returns [] for empty plugin-db dir", () => {
  if (!isNodeSqliteAvailable()) return;
  const registry = new Registry(tmpConfigPath());
  assert.deepEqual(registry.list(), []);
  registry.close();
});

test("Registry.list ignores non-.db files and suspicious names", async () => {
  if (!isNodeSqliteAvailable()) return;
  const cfg = tmpConfigPath();
  const dbDir = path.join(cfg, "plugin-db");
  fs.mkdirSync(dbDir, { recursive: true });
  fs.writeFileSync(path.join(dbDir, "real.db"), "");
  fs.writeFileSync(path.join(dbDir, "README.md"), "");
  fs.writeFileSync(path.join(dbDir, "with spaces.db"), "");

  const registry = new Registry(cfg);
  assert.deepEqual(
    registry.list().map((d) => d.id),
    ["real"],
  );
  registry.close();
});

test("Registry.getReadOnly opens cached RO handle, undefined for missing", async () => {
  if (!isNodeSqliteAvailable()) return;
  const cfg = tmpConfigPath();
  const db = await openPluginDb({ config: { configPath: cfg } }, "present");
  await db.run("CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1), (2)");

  const registry = new Registry(cfg);
  const ro1 = registry.getReadOnly("present");
  const ro2 = registry.getReadOnly("present");
  assert.strictEqual(ro1, ro2, "second call returns cached handle");
  assert.equal(registry.getReadOnly("missing"), undefined);

  // RO handle should refuse writes
  assert.throws(() => ro1!.exec("INSERT INTO t VALUES (3)"));
  registry.close();
});
