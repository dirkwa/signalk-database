# AGENTS.md

Contributor / agent notes for working in this repo. See [README.md](README.md) for what the plugin does and who it's for.

## Two faces of this package

`signalk-database` is both a **library** and a **plugin** in the same npm package:

- **Library** — `import { openPluginDb } from 'signalk-database'`. Pure functions; works in any process that has node:sqlite. Doesn't depend on the plugin lifecycle.
- **Plugin** — when enabled in the SignalK admin UI, mounts a router that serves the web admin (file-scans `{configPath}/plugin-config-data/*/db.sqlite`).

The package `main` points at the plugin entry. The plugin entry **also re-exports** the library API, so a single `main` covers both faces. signalk-server's plugin loader picks up the default export (the plugin factory); consumer plugins importing the package get the named exports (the library).

## Layout

```
src/
├── lib/
│   ├── db.ts       openPluginDb / closeAll / pluginDbPath — pure library, no plugin context
│   ├── types.ts    TypeBox schemas + derived TS types for PluginDb, Migration, RunResult, and admin-API shapes
│   └── index.ts    public library export
├── plugin/
│   ├── index.ts    plugin factory; mounts router and re-exports the library
│   ├── registry.ts file-scan + RO handle cache for the admin UI
│   ├── routes.ts   /api/* endpoints (databases / tables / schema / rows)
│   └── schema.ts   PRAGMA introspection
├── webapp/         React 19 + Vite + Tailwind v4 → public/
│   ├── App.tsx, main.tsx, styles.css, global.d.ts
│   ├── api/client.ts   API base hard-coded to /plugins/signalk-database/api (see "URL paths" below)
│   └── pages/DbList.tsx, DbView.tsx
└── test/           node:test files compiled to dist-test/ (NOT shipped)

app-icon.svg                       — copied into public/ by `build:icon` so the SignalK admin UI can fetch it at /signalk-database/app-icon.svg
index.html, vite.config.ts         — Vite injects `__APP_VERSION__` from package.json at build time (shown in webapp header)
tsconfig.{plugin,webapp,test}.json
.github/                           — shared SignalK plugin-ci, publish on v* tag, dependabot
```

Published tarball ships `dist/{lib,plugin}/`, `public/` (incl. `app-icon.svg`), `app-icon.svg` (root copy), `README.md`, `LICENSE`. Tests compile to `dist-test/` and are excluded from publish.

## URL paths — webapp vs API

SignalK serves these on different paths:

- **Webapp** (the React UI) → `/signalk-database/` — served by the static handler that `registerWithRouter` mounts on the plugin router, which the server exposes at the webapp path.
- **Plugin routes** (our `/api/*`) → `/plugins/signalk-database/api/*` — the SignalK server's standard plugin-router mount point.

The webapp's API client (`src/webapp/api/client.ts`) hardcodes `/plugins/signalk-database/api` as the base. Don't try to make the API live under the webapp path — the SignalK server's outer admin-authentication middleware is mounted on `/plugins/*` and is what gates our routes.

## HTTP API surface

All routes mount under `/plugins/signalk-database/api/`. Gated by SignalK's outer admin-authentication middleware (see "Auth model" below). Two groups:

### Browse (internal, consumed by our own webapp)

| Route | Purpose |
| --- | --- |
| `GET /databases` | Manifest: `{id, path, sizeBytes, modifiedAt}[]` for every plugin DB on disk. |
| `GET /databases/:id/tables` | `{name, rowCount}[]`. User tables only (`sqlite_*` excluded). |
| `GET /databases/:id/tables/:table/schema` | Columns, indexes, foreign keys. |
| `GET /databases/:id/tables/:table/rows?limit=&offset=` | Paginated rows, capped at 500/req. |

The webapp imports types from `src/lib/types.ts`. Free to change shape as the webapp evolves — these are internal contracts.

### Full-export (stable public API, consumed by signalk-backup)

| Route | Purpose |
| --- | --- |
| `GET /full-export/databases` | Backup manifest: `{databases: [{id, bytes, modifiedAt}]}`. Mirrors signalk-questdb / signalk-grafana shapes so signalk-backup can treat them uniformly. |
| `GET /full-export/:id` | `application/octet-stream` of a point-in-time SQLite copy produced via `VACUUM INTO`. |

This contract is **stable** — [signalk-backup's SignalKDatabaseExporter](https://github.com/dirkwa/signalk-backup/blob/main/src/database-export/signalk-database.ts) depends on the exact shape. Don't break it without coordinating a paired bump:

- **Response keys** (`databases`, `id`, `bytes`, `modifiedAt`) — never rename in-place. Add new keys freely.
- **Status codes** — `200`/`404`/`400`/`500`/`503` per the existing route. signalk-backup's exporter discriminates on these.
- **Content-Type for `/full-export/:id`** must remain `application/octet-stream` with a `Content-Disposition: attachment` carrying the filename. The exporter streams `res.body` directly to disk.
- **Path validation** — `^[A-Za-z0-9._-]+$` on the id (matches the lib + registry regex). signalk-backup pre-filters with the same pattern; relaxing here means relaxing there too.

If the contract has to change, do it via a coordinated PR pair (this repo + signalk-backup) bumping our minor and the exporter's tolerated version range together.

## Build / test loop

```bash
npm run format     # prettier --write src
npm run build      # tsc -p tsconfig.plugin.json && vite build && build:icon
npm test           # tsc -p tsconfig.test.json && node --test dist-test/test/**/*.test.js
```

Build sub-steps:
- `build:plugin` → `tsc -p tsconfig.plugin.json` (with `declaration: true` so consumer plugins get `.d.ts` types for `openPluginDb` and `PluginDb`)
- `build:webapp` → `vite build` then `build:icon`. The icon copy is chained inside `build:webapp` because Vite's `emptyOutDir: true` clears `public/` on every build — if you only ran `vite build` you'd lose the icon. `vite.config.ts` reads `package.json` and injects `__APP_VERSION__` at build time; bumping the version in `package.json` updates the webapp header on the next build.
- `build:icon` → copies `app-icon.svg` into `public/` so it's reachable at `/signalk-database/app-icon.svg`

`tsconfig.test.json` outputs to `dist-test/` so tests never leak into the published tarball.

## Linking into a live signalk-server

```bash
npm run build

# in ~/.signalk/node_modules/
ln -s /home/dirk/dev/signalk-database signalk-database

# add to ~/.signalk/package.json `dependencies` so the server's scanner picks it up:
#   "signalk-database": "file:./node_modules/signalk-database"
```

Restart signalk-server. Because of `signalk-plugin-enabled-by-default: true` in our `package.json`, the plugin is auto-enabled on first start. The webapp loads at `http://<server>/signalk-database/`.

To exercise the library half from a consumer plugin, that plugin needs `signalk-database` resolvable from its own location — same npm-link trick, or just have both plugins installed under `~/.signalk/node_modules/`.

## Auth model

We do **not** add our own admin gate on the API. SignalK's `tokensecurity.ts` already wraps `/plugins/<id>/*` in `adminAuthenticationMiddleware`, which bypasses auth when server security is disabled and enforces admin role when it is enabled. Any request that reaches our routes has already passed that check.

This matters because: the default `dummysecurity` strategy has no `hasAdminAccess` function at all. An inner middleware that fails closed on missing `hasAdminAccess` would block every request on a no-security-configured server — the common hobby install. The SignalK server's outer middleware is the right authority; trust it.

## Architecture quick reference

- **`openPluginDb(app)`** is independent of the plugin lifecycle. Caches handles in a module-scope `Map` keyed by absolute DB path. Creates `<app.getDataDirPath()>/db.sqlite` if absent, sets WAL + foreign keys, ensures the `_migrations` table. Note: takes only `app` — never `pluginId`. The data dir is always plugin-scoped by the server, so the library physically cannot reach another plugin's data.
- **`Registry`** (admin/UI side) is the *only* code that walks across plugin scopes. It takes the parent of `app.getDataDirPath()` (i.e. `{configPath}/plugin-config-data/`) and enumerates `<id>/db.sqlite` files. Opens a separate RO `node:sqlite` handle (`PRAGMA query_only = ON`) per DB for browse routes. WAL mode means the RO browse handle doesn't block the consumer plugin's writes.
- **The plugin entry mounts the admin UI but plays no role in handing out DB handles.** The library doesn't need the plugin to be enabled.
- **No direct access to `app.config.configPath`.** The shared SignalK plugin-ci CI flags it; we use `app.getDataDirPath()` instead. The Registry derives the parent dir via `path.dirname()` of our own data dir.
- **Identifier validation:** plugin ids (in `plugin/registry.ts`) and table names (in `plugin/schema.ts`) must match `^[A-Za-z0-9._-]+$`. Anything else is skipped/rejected — prevents path traversal in pluginId and SQL injection via table names. The library's `openPluginDb(app)` does not validate ids because the server-provided `getDataDirPath()` is the trust boundary.

## Type strategy

`src/lib/types.ts` uses [typebox](https://github.com/sinclairzx81/typebox) 1.x (ESM-only) for data shapes. TS types derive via `Type.Static<typeof S>`. The `PluginDb` *interface* (a contract of method signatures, not a data shape) stays as a plain `interface`.

## Branch + PR workflow

Everything goes through a feature branch and a pull request — including version bumps. No direct commits to `master`.

```bash
# 1. Start from up-to-date master
git checkout master
git pull --ff-only

# 2. Branch off
git checkout -b fix/short-description    # or feat/, chore/, docs/, refactor/

# 3. Commit small, focused changes
git add -p
git commit -m "fix: <one-line summary>"

# 4. Push and open a PR
git push -u origin HEAD
gh pr create --fill
```

PR conventions:
- One logical change per PR. Refactors, bug fixes, and feature additions stay separate.
- Title is the commit subject — short, imperative, no trailing period.
- Body explains *why*, not *what* (the diff already shows what).
- Don't amend or force-push during review iteration; add follow-up commits on top so reviewers can see what changed since their last look.
- Wait for CI green and review approval before merging.

### Version bumps are also PRs

Don't run `npm version` on `master`. Open a PR for the bump, get it merged, *then* tag.

```bash
git checkout -b chore/release-v0.2.0
npm version 0.2.0 --no-git-tag-version      # bumps package.json + package-lock only
git commit -am "chore: release v0.2.0"
git push -u origin HEAD
gh pr create --fill
```

The `--no-git-tag-version` flag is the point — npm's default behaviour creates a tag, which would short-circuit the PR review. Once the PR merges to `master`, then:

```bash
git checkout master && git pull --ff-only
git tag v0.2.0
git push --tags
```

The tag push fires [.github/workflows/publish.yml](.github/workflows/publish.yml).

For prereleases use `npm version 0.2.0-beta.0 --no-git-tag-version` — the workflow's regex (`*-beta.*` / `*-rc.*`) routes those to the `beta` dist-tag.

## Release flow

Tag-driven publish via [.github/workflows/publish.yml](.github/workflows/publish.yml):

```bash
# stable release
npm version 0.2.0 -m "release v%s"
git push --follow-tags

# beta — published under `beta` dist-tag, not `latest`
npm version 0.2.0-beta.0 -m "release v%s"
git push --follow-tags
```

The workflow creates a GitHub Release with auto-generated notes (categories defined in [.github/release.yml](.github/release.yml)), then runs `npm publish --provenance --access public`. Beta and rc tags publish under the `beta` dist-tag so `npm install signalk-database` keeps resolving to the previous stable.

### Trusted publishing — one-time setup (do this before the first tag push)

`--provenance` requires npm's [trusted publishing](https://docs.npmjs.com/trusted-publishers) — OIDC instead of a long-lived `NPM_TOKEN`. Without it the workflow's `publish` step will fail with a 401.

Steps (npmjs.com web UI):
1. Sign in as a maintainer of `signalk-database`.
2. Navigate to the package page → **Settings** → **Trusted Publishers** → **Add**.
3. Provider: GitHub Actions.
4. Fill in:
   - **Organization / user:** `dirkwa` (or whoever owns the GitHub repo)
   - **Repository:** `signalk-database`
   - **Workflow filename:** `publish.yml`
   - **Environment:** leave blank (we don't use GitHub Environments here)
5. Save.

Verify by pushing a low-stakes `v0.x.y-beta.0` tag and watching the workflow run — the `publish` job should succeed and `npm view signalk-database@beta` should show the published version.

If you ever rename the repo or move it to another org, the trusted-publisher entry must be updated to match or every release will fail.

### What to do when the workflow fails

- **401 `provenance attestation: unauthorized`** — trusted publishing not configured, or repo/workflow name in the npmjs trusted-publisher entry doesn't match. See above.
- **403 `you do not have permission to publish`** — npm account doesn't own the package, or 2FA-on-publish is enabled and the OIDC bypass isn't set up (trusted publishing also covers this).
- **422 `Error verifying sigstore provenance bundle: package.json: "repository.url" is "...", expected to match "<URL>" from provenance`** — `package.json` either lacks a `repository` field or its `url` doesn't match the GitHub repo signing the provenance. npm cross-checks the two as a security measure. Fix: ensure `package.json` has `"repository": { "type": "git", "url": "git+https://github.com/<owner>/<repo>.git" }` with the URL matching the actual repo (no trailing slash, no `git@` form), commit, re-tag.
- **Hook / build failure pre-publish** — the workflow runs `npm install` then `npm run build` then `npm publish`. Reproduce locally: `rm -rf node_modules dist dist-test public && npm install && npm run build`. If clean local build passes but CI doesn't, the divergence is usually an env var or Node minor.

> Never `npm publish` manually unless asked. Don't `git push` (incl. tags) without explicit approval.

## CI

[.github/workflows/signalk-ci.yml](.github/workflows/signalk-ci.yml) calls the shared `SignalK/signalk-server/.github/workflows/plugin-ci.yml@master`. Auto-mode runs on every push / PR across Linux x64+arm64, macOS, Windows × Node 22 & 24.

`enable-signalk-integration: false` for now — the integration job installs the plugin into a running signalk-server. Re-enable once we trust the bundled webapp loads under signalk-server's webapp shell on a clean install (it does on this host, but CI is a different env).

## Conventions

- Apache-2.0 license throughout.
- **SPDX header on every TypeScript source file.** First line of every `.ts`/`.tsx`/`.d.ts` file in `src/` (and root configs like `vite.config.ts`) is `// SPDX-License-Identifier: Apache-2.0`. No copyright noise — the SPDX short form is the canonical declaration. CodeRabbit enforces this in code review.
- No CLAUDE.md in the repo tree; use AGENTS.md.
- Test files: `*.test.ts` under `src/test/`, run via `node:test`.
- Prettier for formatting, ESLint (flat-config `eslint.config.js`) for lint. Run `npm run format && npm run lint && npm run build && npm test` before pushing.
- **No direct `app.config.configPath` access.** Use `app.getDataDirPath()`. The shared SignalK plugin-ci flags violations as warnings.
