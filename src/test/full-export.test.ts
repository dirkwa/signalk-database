// SPDX-License-Identifier: Apache-2.0
import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import express from "express";
import { Registry } from "../plugin/registry.js";
import { mountRoutes } from "../plugin/routes.js";
import { openPluginDb, closeAll, isNodeSqliteAvailable } from "../lib/db.js";

function tmpRoot(): string {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), "signalk-database-test-"));
  const root = path.join(cfg, "plugin-config-data");
  fs.mkdirSync(root, { recursive: true });
  return root;
}

function appUnder(root: string, id: string) {
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  return { getDataDirPath: () => dir };
}

afterEach(async () => {
  await closeAll();
});

test("Registry.vacuumInto produces a consistent copy of the DB", async () => {
  if (!isNodeSqliteAvailable()) return;
  const root = tmpRoot();
  const db = await openPluginDb(appUnder(root, "src"));
  // node:sqlite's prepare().run() only executes the first statement
  // (it's a single prepared stmt), so we run the DDL and the INSERT
  // as separate calls.
  await db.run("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)");
  await db.run("INSERT INTO notes (body) VALUES ('a'),('b'),('c')");

  const registry = new Registry(root);
  const dest = path.join(os.tmpdir(), `vacuum-${Date.now()}.sqlite`);
  registry.vacuumInto("src", dest);

  // file exists and is a valid SQLite db with our data
  const stat = fs.statSync(dest);
  assert.ok(stat.isFile());
  assert.ok(stat.size > 0);

  // open it independently and verify rows survived
  const { createRequire } = await import("node:module");
  const req = createRequire(import.meta.url);
  const { DatabaseSync } = req("node:sqlite");
  const copy = new DatabaseSync(dest);
  const rows = copy.prepare("SELECT body FROM notes ORDER BY id").all();
  copy.close();
  assert.deepEqual(
    rows.map((r: { body: string }) => r.body),
    ["a", "b", "c"],
  );

  fs.unlinkSync(dest);
  registry.close();
});

test("Registry.vacuumInto throws for unknown id", () => {
  if (!isNodeSqliteAvailable()) return;
  const registry = new Registry(tmpRoot());
  const dest = path.join(os.tmpdir(), `vacuum-missing-${Date.now()}.sqlite`);
  assert.throws(() => registry.vacuumInto("missing", dest), /not found/);
  assert.throws(() => registry.vacuumInto("../escape", dest), /invalid id/);
  registry.close();
});

test("Registry.vacuumInto refuses to overwrite an existing destination", async () => {
  if (!isNodeSqliteAvailable()) return;
  const root = tmpRoot();
  await openPluginDb(appUnder(root, "src"));
  const registry = new Registry(root);
  const dest = path.join(os.tmpdir(), `vacuum-exists-${Date.now()}.sqlite`);
  fs.writeFileSync(dest, "");
  try {
    assert.throws(() => registry.vacuumInto("src", dest), /already exists/);
  } finally {
    fs.unlinkSync(dest);
    registry.close();
  }
});

// ---------------------------------------------------------------------
// HTTP plumbing — start an ephemeral express server, exercise both
// full-export endpoints over real HTTP.
// ---------------------------------------------------------------------

interface ServerHandle {
  url: string;
  close(): Promise<void>;
}

async function startServer(root: string): Promise<ServerHandle> {
  const registry = new Registry(root);
  const router = express.Router();
  mountRoutes(router, () => registry);
  const app = express();
  app.use("/plugins/signalk-database", router);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("server not listening");
  }
  return {
    url: `http://127.0.0.1:${addr.port}`,
    async close() {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      registry.close();
    },
  };
}

test("GET /api/full-export/databases returns the manifest", async () => {
  if (!isNodeSqliteAvailable()) return;
  const root = tmpRoot();
  await openPluginDb(appUnder(root, "alpha"));
  await openPluginDb(appUnder(root, "beta"));

  const srv = await startServer(root);
  try {
    const res = await fetch(
      `${srv.url}/plugins/signalk-database/api/full-export/databases`,
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      databases: { id: string; bytes: number; modifiedAt: string }[];
    };
    assert.deepEqual(
      body.databases.map((d) => d.id),
      ["alpha", "beta"],
    );
    assert.ok(body.databases.every((d) => d.bytes > 0));
    assert.ok(body.databases.every((d) => typeof d.modifiedAt === "string"));
  } finally {
    await srv.close();
  }
});

test("GET /api/full-export/<id> streams a SQLite file", async () => {
  if (!isNodeSqliteAvailable()) return;
  const root = tmpRoot();
  const db = await openPluginDb(appUnder(root, "src"));
  await db.run("CREATE TABLE k (v INTEGER)");
  await db.run("INSERT INTO k VALUES (42)");

  const srv = await startServer(root);
  try {
    const res = await fetch(
      `${srv.url}/plugins/signalk-database/api/full-export/src`,
    );
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/octet-stream");
    assert.match(
      res.headers.get("content-disposition") ?? "",
      /attachment; filename="src\.sqlite"/,
    );
    const buf = Buffer.from(await res.arrayBuffer());
    // SQLite file magic: "SQLite format 3\0" at byte 0
    assert.equal(buf.subarray(0, 16).toString("latin1"), "SQLite format 3\0");

    // write to disk and verify roundtrip data
    const dest = path.join(os.tmpdir(), `e2e-${Date.now()}.sqlite`);
    fs.writeFileSync(dest, buf);
    const { createRequire } = await import("node:module");
    const req = createRequire(import.meta.url);
    const { DatabaseSync } = req("node:sqlite");
    const copy = new DatabaseSync(dest);
    const row = copy.prepare("SELECT v FROM k").get() as { v: number };
    copy.close();
    fs.unlinkSync(dest);
    assert.equal(row.v, 42);
  } finally {
    await srv.close();
  }
});

test("GET /api/full-export/<unknown> returns 404", async () => {
  if (!isNodeSqliteAvailable()) return;
  const srv = await startServer(tmpRoot());
  try {
    const res = await fetch(
      `${srv.url}/plugins/signalk-database/api/full-export/missing`,
    );
    assert.equal(res.status, 404);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /not found/);
  } finally {
    await srv.close();
  }
});

test("GET /api/full-export/<bad-id> returns 400", async () => {
  if (!isNodeSqliteAvailable()) return;
  const srv = await startServer(tmpRoot());
  try {
    const res = await fetch(
      `${srv.url}/plugins/signalk-database/api/full-export/${encodeURIComponent("../escape")}`,
    );
    assert.equal(res.status, 400);
  } finally {
    await srv.close();
  }
});
