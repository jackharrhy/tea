# artbin CLI

Use the CLI to upload a directory to Artbin, import game assets, or download a folder.

## Install and sign in

Requires Node.js 20 or newer. The current CLI version is 0.4.0.

```bash
npm install --global artbin
artbin login
```

Login opens your browser. The CLI connects to `https://artbin.jackharrhy.dev` by default. To use another server, run `artbin login <server-url>`.

## Upload files

Use `add` for a directory of files. It keeps the directory structure and skips dotfiles and `node_modules`.

```bash
artbin add ./my-files --dry-run
artbin add ./my-files
```

The directory name becomes the Artbin folder name. Use `--folder <slug>` to choose another. A dry run shows what would be uploaded without sending files.

## Import game assets

Use `scan` to inspect a game directory, then `import` to upload supported assets, including files found in archives.

```bash
artbin scan ./game
artbin import ./game --dry-run
artbin import ./game
```

`import` also accepts `--folder <slug>`.

## Browse and download

```text
artbin folders list
artbin folders show <slug>
artbin pull <slug> [destination]
```

You can inspect and download public folders with any Artbin account. `pull` downloads a folder ZIP.
Optional flags include `--tree`, `--all`, `--json`, and `--force`.

## Organize folders

```text
artbin folders rename <slug> <new-name>
artbin folders move <slug> --to <destination-or-root>
artbin logout
```

Only administrators can create, rename, or move folders. Rename and move show a preview before confirmation. Use `--dry-run` to preview without changing anything, `--yes` to skip confirmation, or `--json` for scripts.

## Upload behavior

Regular-user uploads go to the review inbox. The CLI retries interrupted uploads and skips files already indexed with the same size and checksum. It reports conflicts instead of overwriting files. Files may be up to 512 MiB each.

## Tea development

This workspace publishes the npm package `artbin`. From the Tea root, run `npm ci`, then `npm run check --workspace artbin` or `npm run build --workspace artbin`. `src/index.ts` is the CLI entry point, `src/commands/` owns commands, and `src/ui/` builds the interactive scan view. The publish script is `scripts/publish.mjs`; it verifies the package before release. Shared asset logic lives in `packages/artbin-core` and CLI UI primitives in `packages/artbin-ui`. Server routes and storage stay in `apps/artbin`.
