// SPDX-License-Identifier: Apache-2.0
import express, { type Router } from "express";
import { getRowsPage, getTableSchema, listTables } from "./schema.js";
import type { Registry } from "./registry.js";

const MAX_ROWS_PER_PAGE = 500;

/**
 * Mount the admin API on the plugin router. The SignalK server already
 * wraps `/plugins/<id>/*` in its own `adminAuthenticationMiddleware`, so
 * any request that reaches here has either passed the server's admin
 * check or arrived while security is disabled. We do not add a second
 * gate; doing so blocks the common no-security-configured case where
 * the server's outer gate intentionally passes the request through.
 */
export function mountRoutes(
  router: Router,
  getRegistry: () => Registry | null,
): void {
  const api = express.Router();

  api.get("/databases", (_req, res) => {
    const registry = getRegistry();
    if (!registry) {
      res.status(503).json({ error: "plugin not started" });
      return;
    }
    res.json(registry.list());
  });

  api.get("/databases/:id/tables", (req, res) => {
    const registry = getRegistry();
    if (!registry) {
      res.status(503).json({ error: "plugin not started" });
      return;
    }
    const db = registry.getReadOnly(req.params.id);
    if (!db) {
      res.status(404).json({ error: `database not found: ${req.params.id}` });
      return;
    }
    try {
      res.json(listTables(db));
    } catch (err) {
      res.status(500).json({ error: errMessage(err) });
    }
  });

  api.get("/databases/:id/tables/:table/schema", (req, res) => {
    const registry = getRegistry();
    if (!registry) {
      res.status(503).json({ error: "plugin not started" });
      return;
    }
    const db = registry.getReadOnly(req.params.id);
    if (!db) {
      res.status(404).json({ error: `database not found: ${req.params.id}` });
      return;
    }
    try {
      res.json(getTableSchema(db, req.params.table));
    } catch (err) {
      res.status(400).json({ error: errMessage(err) });
    }
  });

  api.get("/databases/:id/tables/:table/rows", (req, res) => {
    const registry = getRegistry();
    if (!registry) {
      res.status(503).json({ error: "plugin not started" });
      return;
    }
    const db = registry.getReadOnly(req.params.id);
    if (!db) {
      res.status(404).json({ error: `database not found: ${req.params.id}` });
      return;
    }
    const limit = clampInt(req.query.limit, 50, 1, MAX_ROWS_PER_PAGE);
    const offset = clampInt(req.query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    try {
      res.json(getRowsPage(db, req.params.table, limit, offset));
    } catch (err) {
      res.status(400).json({ error: errMessage(err) });
    }
  });

  router.use("/api", api);
}

function clampInt(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
