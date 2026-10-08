# artbin CLI

Scan local game directories, import assets, inspect an artbin server, download folder ZIPs, and
organize server folders.

## Install

```bash
npm install --global artbin
artbin login
```

`artbin login` uses `https://artbin.jackharrhy.dev` by default. Pass another server URL to connect
to a self-hosted instance.

Use CLI 0.4.0 with the current server. Uploads use resumable tus transfers in 1 MiB chunks,
with two files in flight. Processing and folder previews run as jobs that the CLI waits for.
Interrupted requests retry from the server's recorded offset; restarting the CLI skips files
already indexed with matching size and checksum. Conflicting files are reported, not overwritten.
Individual files may be up to 512 MiB.

## Commands

```text
artbin login [server-url]
artbin logout
artbin scan <path>
artbin import <path> [--folder <slug>] [--dry-run]
artbin add <path> [--folder <slug>] [--dry-run]

artbin folders list [--tree] [--all] [--json]
artbin folders show <slug> [--json]
artbin pull <slug> [destination] [--force] [--json]
artbin folders rename <slug> <new-name> [--dry-run] [--yes] [--json]
artbin folders move <slug> --to <destination-or-root> [--dry-run] [--yes] [--json]
```

All authenticated users can inspect and download public folders. Regular-user uploads are sent to
the review inbox. Creating, renaming, and moving folders requires an administrator account.

Folder mutations preview their impact before confirmation. Use `--dry-run` to inspect a change and
`--json` for scripts or other tooling.

## Tea development

This workspace keeps the published npm package name `artbin` and its default production server URL. From the Tea root, run `npm ci`, then `npm run check --workspace artbin` or `npm run build --workspace artbin`. `src/index.ts` is the CLI entry point, `src/commands/` owns commands, and `src/ui/` builds the interactive scan view. The publish script is `scripts/publish.mjs`; it verifies the package before any release. Shared asset logic lives in `packages/artbin-core` and CLI UI primitives in `packages/artbin-ui`. Server routes and storage stay in `apps/artbin`.
