// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { getRowsPage, getTableSchema, listTables } from "../plugin/schema.js";

const require = createRequire(import.meta.url);

function openTmpDb(): { db: unknown; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "signalk-database-test-"));
  const file = path.join(dir, "test.db");
  let SqliteDatabase: { new (path: string): unknown } | undefined;
  try {
    SqliteDatabase = require("node:sqlite").DatabaseSync;
  } catch {
    SqliteDatabase = undefined;
  }
  if (!SqliteDatabase) return { db: null, cleanup: () => undefined };
  const db = new SqliteDatabase(file);
  return {
    db,
    cleanup: () => {
      (db as { close(): void }).close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("listTables returns user tables with row counts, skips sqlite_* internals", () => {
  const { db, cleanup } = openTmpDb();
  if (!db) return;
  try {
    const d = db as {
      exec(s: string): void;
      prepare(s: string): { run(...a: unknown[]): unknown };
    };
    d.exec("CREATE TABLE foo (id INTEGER PRIMARY KEY)");
    d.exec("CREATE TABLE bar (id INTEGER PRIMARY KEY)");
    d.prepare("INSERT INTO foo (id) VALUES (?)").run(1);
    d.prepare("INSERT INTO foo (id) VALUES (?)").run(2);
    const tables = listTables(d);
    assert.deepEqual(
      tables.map((t) => t.name),
      ["bar", "foo"],
    );
    const foo = tables.find((t) => t.name === "foo");
    assert.equal(foo?.rowCount, 2);
  } finally {
    cleanup();
  }
});

test("getTableSchema reports columns, PK, and notnull", () => {
  const { db, cleanup } = openTmpDb();
  if (!db) return;
  try {
    const d = db as { exec(s: string): void };
    d.exec(
      "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, age INTEGER)",
    );
    const schema = getTableSchema(d, "users");
    assert.equal(schema.table, "users");
    assert.equal(schema.columns.length, 3);
    const id = schema.columns.find((c) => c.name === "id");
    const name = schema.columns.find((c) => c.name === "name");
    assert.equal(id?.primaryKey, true);
    assert.equal(name?.notNull, true);
  } finally {
    cleanup();
  }
});

test("getRowsPage paginates and projects row arrays", () => {
  const { db, cleanup } = openTmpDb();
  if (!db) return;
  try {
    const d = db as {
      exec(s: string): void;
      prepare(s: string): { run(...a: unknown[]): unknown };
    };
    d.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");
    const ins = d.prepare("INSERT INTO items (name) VALUES (?)");
    for (let i = 0; i < 7; i++) ins.run(`item-${i}`);
    const page = getRowsPage(d, "items", 3, 2);
    assert.equal(page.total, 7);
    assert.equal(page.rows.length, 3);
    assert.deepEqual(page.columns, ["id", "name"]);
    assert.equal(page.rows[0][1], "item-2");
  } finally {
    cleanup();
  }
});

test("schema introspection rejects suspicious identifiers", () => {
  const { db, cleanup } = openTmpDb();
  if (!db) return;
  try {
    const d = db as { exec(s: string): void };
    d.exec("CREATE TABLE ok (x INTEGER)");
    assert.throws(() => getTableSchema(d, "ok; DROP TABLE ok"));
  } finally {
    cleanup();
  }
});
