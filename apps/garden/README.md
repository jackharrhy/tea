# Tea Garden

Jack Harrhy's Obsidian-backed personal site, migrated from `jackharrhy/jackharrhy.com` to native Remix 3. This is an independent Node app, not a TeaCMS site. Its routes, Markdown extensions, components, feeds, import tools, and publishing workflow belong here.

## Develop

Use the root Node version and `npm ci`. Copy `.env.example` to `.env` in this directory and set absolute paths to your external vault's `Garden` and `Assets` directories. Run `npm run garden:dev` from the Tea root and open <http://localhost:4322>. Notes are never stored in Tea. Vault edits invalidate the content index and reload the browser; code edits restart the server. Only notes explicitly marked `public: true` are served, even locally.

`server.ts` owns the Node host and development watcher. `app/routes.ts`, `app/router.tsx`, and `app/ui/` own HTTP and presentation. `app/content/` owns indexing, frontmatter, Obsidian Markdown, and publishing snapshots. `scripts/` contains publishing, asset, and Raindrop tools. `public/` holds only site-owned static assets, not vault content.

## Checks

Run `npm run check --workspace @tea/garden` for typecheck and fixture-based server tests, or `npm run garden:check` for shared tooling too. Run `npm run test:parity --workspace @tea/garden` with the original Astro site on port 4321 and Garden on port 4322 for browser comparisons. Tests and generated fixtures live in `__tests__/`; ignored local state belongs in `tmp/`.

The parity runner uses installed Chrome, captures full pages at 1440, 768, and 390 pixels, and compares readable text and pixels. It hides the live mug/iframes, stubs now-playing, and freezes GIFs at their first frame so animations do not create false differences. Override `GARDEN_BEFORE_URL` and `GARDEN_AFTER_URL` to compare staged deployments. The initial migration matched all 30 captures exactly. The original mobile overflow on Quake and one linkblog page is intentionally preserved, not redesigned.

`/debug` lists public pages; `/debug/compare` compares against production (or `GARDEN_COMPARE_URL`) and stores review notes in ignored `.garden/`. `/debug/linkblog` keeps the Raindrop status and Obsidian deep links. Import commands retain their existing names; draft-writing and sync commands are explicit mutations, not part of dev startup or publishing.

## Publishing and runtime

Development reads the external vault directly. Production reads an explicit public-only snapshot at `GARDEN_CONTENT_PATH`; it never needs the personal vault. `npm run content:export --workspace @tea/garden` validates and writes an ignored snapshot under `tmp/published/`. Deploying application code and publishing writing are separate operations. Media keeps the existing `/asset/` URLs and production CDN at <https://garden.jack.camera>.

Set `GARDEN_COMPARE_URL=https://jackharrhy.com` when exporting to compare page hashes with the deployed manifest. Export fails on missing media, conflicting routes, unknown components, or public linkblog entries without their existing required metadata. It preserves public Markdown byte for byte, records only media referenced by those pages, refuses to overwrite a snapshot, and neither uploads nor deploys anything. The infrastructure repository's Garden guide owns the confirmation, media upload, snapshot activation, restart, and rollback procedure. Legacy `assets:*` commands still operate on the whole asset directory; use them deliberately, not as an automatic publishing step.

The local container is opt-in: set `GARDEN_VAULT_ROOT` to the external vault root and run `docker compose --profile garden up --build garden traefik` to open <http://garden.localhost>. The vault mount is read-only. Tea publishes `ghcr.io/jackharrhy/tea-garden` from `main`; the image contains application code only and requires a separately mounted snapshot.

`app/ui/legacy-styles.ts` carries the original compiled styles as a Remix `css(...)` mixin; `public/properties.css` contains the CSS property registrations and font faces. `scripts/import-styles.mjs` records the one-time conversion, not a runtime or build dependency on Astro or Tailwind. The original bundled picoCAD viewer is retained unmodified, with upstream licenses beside it; formatting and lint skip that vendored file.

The canonical origin defaults to <https://jackharrhy.dev>; the existing `.com` and other host aliases remain infrastructure concerns. Analytics are production-only. Debug pages and Raindrop authoring tools are development-only. Host configuration, secrets, persistent snapshot transfer, and production cutover belong in the infrastructure repository. Keep the original deployment available until parity and the production smoke checks pass.

Do not rewrite Jack's vault prose. Preserve source wording and existing URL conventions during migration. Do not commit notes, media, credentials, generated manifests, or snapshots.
