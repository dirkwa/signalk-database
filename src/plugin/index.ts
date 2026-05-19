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
  getDataDirPath(): string;
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
      // Our own data dir (e.g. {configPath}/plugin-config-data/signalk-database)
      // sits next to every other plugin's data dir. The admin Registry walks
      // that parent dir to enumerate sibling plugins' databases.
      const parentDir = path.dirname(app.getDataDirPath());
      registry = new Registry(parentDir);
      app.debug?.(
        `signalk-database admin UI started; scanning ${parentDir}/*/db.sqlite`,
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
