# signalk-database

A SQLite library and admin UI for [SignalK Node Server](https://signalk.org/) plugins. Other plugins import `signalk-database` to get an isolated per-plugin SQLite database; the admin webapp browses every database on disk.

**Status:** early development (0.1.0). No server-side cooperation needed — works against stock signalk-server.

## For plugin authors

Add `signalk-database` as a peer dependency and import the library:

```js
// package.json
{
  "peerDependencies": {
    "signalk-database": "^0.1"
  }
}
```

```ts
import { openPluginDb } from 'signalk-database';

export default function (app) {
  let db;
  return {
    id: 'my-plugin',
    name: 'My Plugin',
    async start() {
      db = await openPluginDb(app);
      await db.migrate([
        {
          version: 1,
          sql: 'CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)',
        },
      ]);
    },
    async stop() {
      // db handles are cached per-process; nothing to close per plugin.
    },
  };
}
```

The library exposes a `PluginDb` interface:

```ts
interface PluginDb {
  migrate(migrations: Migration[]): Promise<void>;
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<RunResult>;
  transaction<T>(fn: (tx: PluginDb) => Promise<T>): Promise<T>;
}
```

Each plugin's database lives at `{configPath}/plugin-config-data/{pluginId}/db.sqlite` — the standard SignalK plugin data directory that `app.getDataDirPath()` returns. The library never touches `app.config.configPath` directly, so a plugin cannot reach across into another plugin's data. WAL mode, foreign keys on. Repeated calls to `openPluginDb(app)` return the cached handle.

## For server admins

Install from the SignalK Appstore (or `npm install signalk-database` into `~/.signalk/`). The plugin enables itself on a fresh install (`signalk-plugin-enabled-by-default`), so it starts running after the next server restart with no admin-UI configuration needed.

Visit `http://<your-server>/signalk-database/` for the web admin UI. It:

- Lists every plugin database on disk
- Shows tables, schemas, indexes, foreign keys
- Pages through table rows (read-only)

The admin UI **file-scans** `{configPath}/plugin-config-data/*/db.sqlite`, so it sees every database regardless of whether the owning plugin is currently running. This is the only place in `signalk-database` that walks across plugin scopes, which is appropriate for an admin/inspector role.

## Requirements

- **Node 22.5.0 or newer.** The library uses `node:sqlite`; older Node versions don't have it.
- **Admin auth.** The plugin mounts its API under `/plugins/signalk-database/api/*`, which the SignalK server itself wraps in its admin-authentication middleware. When server security is configured, only admin users can reach the API; when it is disabled, the server allows the request through and our routes follow suit.

## Why a peer dependency?

Peer-dep semantics ensure a single shared install across all consumer plugins:

- One copy of `signalk-database`, one shared handle cache per process — no duplicate SQLite handles racing on the same file.
- The admin UI sees every plugin DB without per-plugin glue.
- npm warns if a consumer plugin's peer is unsatisfied, surfacing the missing install.

## Contributing

See [AGENTS.md](AGENTS.md) for build/test/release notes and architecture pointers.

## License

Apache-2.0
