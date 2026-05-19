// SPDX-License-Identifier: Apache-2.0
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "./registry.js";
import { mountRoutes } from "./routes.js";

// Re-export the library API so consumers can do
//   import { openPluginDb } from 'signalk-database'
// regardless of whether this plugin is enabled.
export { openPluginDb, closeAll, pluginDbPath } from "../lib/index.js";
export type {
  Migration,
  PluginDb,
  RunResult,
  PluginDbInfo,
  TableInfo,
  ColumnInfo,
  IndexInfo,
  ForeignKeyInfo,
  TableSchema,
  RowsPage,
} from "../lib/index.js";

interface SignalKApp {
  config: { configPath: string };
  debug?: (msg: string, ...rest: unknown[]) => void;
  error?: (msg: string, ...rest: unknown[]) => void;
}

export default function (app: SignalKApp) {
  let registry: Registry | null = null;

  return {
    id: "signalk-database",
    name: "Database",
    description:
      "SQLite library + admin UI for SignalK plugins. Other plugins import { openPluginDb } from 'signalk-database' to get an isolated database handle.",

    schema: {
      type: "object",
      properties: {},
    },

    start() {
      registry = new Registry(app.config.configPath);
      app.debug?.(
        `signalk-database admin UI started; scanning ${app.config.configPath}/plugin-db`,
      );
    },

    stop() {
      if (registry) {
        registry.close();
        registry = null;
      }
    },

    registerWithRouter(router: express.Router) {
      mountRoutes(router, () => registry);

      const here = path.dirname(fileURLToPath(import.meta.url));
      const publicDir = path.resolve(here, "..", "..", "public");
      router.use(express.static(publicDir));
    },
  };
}
