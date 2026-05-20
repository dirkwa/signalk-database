// SPDX-License-Identifier: Apache-2.0
import express, { type Router } from "express";
import fs from "node:fs";
import { createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { getRowsPage, getTableSchema, listTables } from "./schema.js";
import type { Registry } from "./registry.js";

const MAX_ROWS_PER_PAGE = 500;
const ID_RE = /^[A-Za-z0-9._-]+$/;

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

  // ---------------------------------------------------------------
  // Full-export endpoints (consumed by signalk-backup or curl)
  // ---------------------------------------------------------------

  /**
   * Manifest: every plugin DB available for backup, with size + mtime.
   * Mirrors the shape signalk-backup's exporters expect (see
   * signalk-backup/src/database-export/grafana.ts).
   */
  api.get("/full-export/databases", (_req, res) => {
    const registry = getRegistry();
    if (!registry) {
      res.status(503).json({ error: "plugin not started" });
      return;
    }
    const databases = registry.list().map((d) => ({
      id: d.id,
      bytes: d.sizeBytes,
      modifiedAt: d.modifiedAt,
    }));
    res.json({ databases });
  });

  /**
   * Stream a consistent point-in-time copy of one plugin's db.sqlite,
   * produced via `VACUUM INTO` to a tempfile. The tempfile is unlinked
   * after the stream completes (or fails).
   */
  api.get("/full-export/:id", async (req, res) => {
    const registry = getRegistry();
    if (!registry) {
      res.status(503).json({ error: "plugin not started" });
      return;
    }
    const id = req.params.id;
    if (!ID_RE.test(id)) {
      res.status(400).json({ error: `invalid id: ${id}` });
      return;
    }

    // Stage the VACUUM INTO output in os.tmpdir() with an unguessable
    // suffix. Cleanup happens unconditionally in `finally`.
    const tmpPath = path.join(
      os.tmpdir(),
      `signalk-database-${id}-${randomBytes(8).toString("hex")}.sqlite`,
    );

    try {
      try {
        registry.vacuumInto(id, tmpPath);
      } catch (err) {
        const msg = errMessage(err);
        if (
          msg.startsWith("database not found") ||
          msg.startsWith("invalid id")
        ) {
          res.status(404).json({ error: msg });
        } else {
          res.status(500).json({ error: msg });
        }
        return;
      }

      const stat = fs.statSync(tmpPath);
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Length", String(stat.size));
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${id}.sqlite"`,
      );

      await pipeline(createReadStream(tmpPath), res);
    } catch (err) {
      // If headers already went out, the connection is the best we can do.
      if (!res.headersSent) {
        res.status(500).json({ error: errMessage(err) });
      } else {
        res.end();
      }
    } finally {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // tempfile may not exist if VACUUM INTO failed before writing;
        // unlink failure here is not actionable.
      }
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
