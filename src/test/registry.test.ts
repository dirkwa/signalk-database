// SPDX-License-Identifier: Apache-2.0
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Registry } from "../plugin/registry.js";
import { openPluginDb, closeAll, isNodeSqliteAvailable } from "../lib/db.js";

/** Set up `{tmp}/plugin-config-data/` as the registry root. */
function tmpRoot(): string {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), "signalk-database-test-"));
  const root = path.join(cfg, "plugin-config-data");
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/** Mock an app whose data dir lives under `root/<id>/`. */
function appUnder(root: string, id: string) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  return {
    getDataDirPath: () => dir,
  };
}

afterEach(async () => {
  await closeAll();
});

test("Registry.list returns DBs discovered on disk, sorted", async () => {
  if (!isNodeSqliteAvailable()) return;
  const root = tmpRoot();
  await openPluginDb(appUnder(root, "beta"));
  await openPluginDb(appUnder(root, "alpha"));

  const registry = new Registry(root);
  const list = registry.list();
  assert.deepEqual(
    list.map((d) => d.id),
    ["alpha", "beta"],
  );
  assert.ok(list.every((d) => d.sizeBytes >= 0));
  registry.close();
});

test("Registry.list returns [] for empty root", () => {
  if (!isNodeSqliteAvailable()) return;
  const registry = new Registry(tmpRoot());
  assert.deepEqual(registry.list(), []);
  registry.close();
});

test("Registry.list skips plugin dirs without db.sqlite + suspicious names", async () => {
  if (!isNodeSqliteAvailable()) return;
  const root = tmpRoot();
  await openPluginDb(appUnder(root, "real"));
  // plugin dir with no db.sqlite
  fs.mkdirSync(path.join(root, "no-db-yet"), { recursive: true });
  // plugin dir with non-db file
  fs.writeFileSync(path.join(root, "no-db-yet", "settings.json"), "{}");
  // suspicious id
  fs.mkdirSync(path.join(root, "with spaces"), { recursive: true });
  fs.writeFileSync(path.join(root, "with spaces", "db.sqlite"), "");

  const registry = new Registry(root);
  assert.deepEqual(
    registry.list().map((d) => d.id),
    ["real"],
  );
  registry.close();
});

test("Registry.getReadOnly opens cached RO handle, undefined for missing", async () => {
  if (!isNodeSqliteAvailable()) return;
  const root = tmpRoot();
  const db = await openPluginDb(appUnder(root, "present"));
  await db.run("CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1), (2)");

  const registry = new Registry(root);
  const ro1 = registry.getReadOnly("present");
  const ro2 = registry.getReadOnly("present");
  assert.strictEqual(ro1, ro2, "second call returns cached handle");
  assert.equal(registry.getReadOnly("missing"), undefined);
  assert.equal(registry.getReadOnly("../escape"), undefined);

  // db.sqlite is a directory, not a file — getReadOnly must refuse
  // (would otherwise attempt to open a dir as a sqlite file, surprising
  // the caller with an opaque error from node:sqlite)
  const dirCase = path.join(root, "dir-case");
  fs.mkdirSync(path.join(dirCase, "db.sqlite"), { recursive: true });
  assert.equal(registry.getReadOnly("dir-case"), undefined);

  // RO handle should refuse writes
  assert.throws(() => ro1!.exec("INSERT INTO t VALUES (3)"));
  registry.close();
});
