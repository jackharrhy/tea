# tea

a Remix 3 monorepo for personal apps and packages.

### Apps

<!-- prettier-ignore -->
| Workspace | What it runs | Guide |
| --- | --- | --- |
| [`@tea/artbin`](apps/artbin/) | Game asset archive, uploads, previews, and API | [README](apps/artbin/README.md) |
| [`@jackharrhy/tea-artbin`](apps/artbin-cli/) | Game asset command-line client | [README](apps/artbin-cli/README.md) |
| [`@tea/burger`](apps/burger/) | Remix game UI and authoritative Bun world server | [README](apps/burger/README.md) |
| [`@tea/cms`](apps/cms/) | Multi-site CMS, operator dashboard, and Node host | [README](apps/cms/README.md) |
| [`@tea/cms-edge`](apps/cms-edge/) | Cloudflare Worker CMS backed by D1 and R2 | [README](apps/cms-edge/README.md) |
| [`@tea/letters-to-steve`](apps/letters-to-steve/) | Private correspondence and editorial publishing for Steve | [README](apps/letters-to-steve/README.md) |
| [`@tea/maps`](apps/maps/) | Remix 3 BSP viewer and map editor | [README](apps/maps/README.md) |
| [`@tea/marky`](apps/marky/) | Collaborative Markdown editor with Discord access | [README](apps/marky/README.md) |
| [`@tea/pool-app`](apps/pool/) | Remix pool hall and authoritative Bun game server | [README](apps/pool/README.md) |
| [`@tea/maps-collaboration`](apps/maps-collaboration/) | Live map sessions and SQLite map cells | [README](apps/maps-collaboration/README.md) |
| [`@tea/maps-compiler`](apps/maps-compiler/) | Local native map compiler helper | [README](apps/maps-compiler/README.md) |
| [`@tea/maps-service`](apps/maps-service/) | Hosted map projects and API | [README](apps/maps-service/README.md) |
| [`@tea/ref`](apps/ref/) | Private image and link boards on a Worker and Celld | [README](apps/ref/README.md) |
| [`@tea/radio`](apps/radio/) | Synchronized listening rooms on a Worker and Celld | [README](apps/radio/README.md) |

### Packages

<!-- prettier-ignore -->
| Workspace | What it provides | Guide |
| --- | --- | --- |
| [`@tea/artbin-core`](packages/artbin-core/) | Asset scanning, detection, and upload primitives | [README](packages/artbin-core/README.md) |
| [`@tea/artbin-ui`](packages/artbin-ui/) | CLI scan interface components | [README](packages/artbin-ui/README.md) |
| [`@tea/burger-core`](packages/burger-core/) | Shared Burger ECS, physics, and wire constants | [README](packages/burger-core/README.md) |
| [`@tea/identity`](packages/identity/) | Jack Auth OIDC and API identity verification | [README](packages/identity/README.md) |
| [`@tea/json-schema`](packages/json-schema/) | Remix data schemas with JSON Schema descriptions | [README](packages/json-schema/README.md) |
| [`@tea/logger`](packages/logger/) | Request and job logging primitives | [README](packages/logger/README.md) |
| [`@tea/maps-editor`](packages/maps-editor/) | Map document and source-rendering primitives | [README](packages/maps-editor/README.md) |
| [`@tea/maps-protocol`](packages/maps-protocol/) | Hosted and collaborative map schemas | [README](packages/maps-protocol/README.md) |
| [`@jackharrhy/tea-maps-renderer`](packages/maps-renderer/) | Embeddable WebGPU map renderer and BSP core | [README](packages/maps-renderer/README.md) |
| [`@tea/mcp`](packages/mcp/) | MCP tools, resources, and Streamable HTTP handler | [README](packages/mcp/README.md) |
| [`@tea/pool`](packages/pool/) | Shared pool rules, Box3D physics, and recordings | [README](packages/pool/README.md) |
| [`@tea/pool-protocol`](packages/pool-protocol/) | Versioned pool WebSocket messages | [README](packages/pool-protocol/README.md) |
| [`@tea/pool-simulation`](packages/pool-simulation/) | Hall movement and navigation | [README](packages/pool-simulation/README.md) |
| [`@tea/request-body`](packages/request-body/) | Bounded Web request-body reading | [README](packages/request-body/README.md) |
| [`@tea/result`](packages/result/) | Success and failure values and helpers | [README](packages/result/README.md) |
| [`@tea/rich-text`](packages/rich-text/) | Inline document format and rich text editor | [README](packages/rich-text/README.md) |

## Working in the repo

Use the latest Node.js 24 LTS release (`.nvmrc`; minimum 24.3). Install from the root:

```sh
npm ci
```

Run workspace scripts with `npm run <script> --workspace <name>`. For example, `npm run dev --workspace @tea/cms` starts CMS. Run `npm run` for root scripts, including `npm run artbin:check`, `npm run cms:check`, `npm run letters-to-steve:check`, `npm run ref:check`, `npm run radio:check`, and `npm run maps:check`. Each workspace README has its own setup and checks.

Vite+ runs Oxfmt and Oxlint from [`vite.config.ts`](vite.config.ts). `npm run tooling:check` builds the three importable Maps packages, generates missing Worker types, then checks formatting and type-aware lint through tsrslint. `npm run format` formats files. `npm run knip:check` runs the full unused-code audit in CI. The [Knip config](knip.jsonc) lists browser, Worker, public package, and other entry points that are not visible through imports. Review Knip findings before deleting code.

Workspace `typecheck` and declaration/build scripts use tsrs. `npm run typecheck:tsrs` checks every workspace after Worker types have been generated. `npm run lint` runs the same type-aware Oxlint configuration used in CI.

The local [`compose.yml`](compose.yml) runs Traefik and the containerized apps. Run `docker compose up --build -d`, then open [andrew.localhost](http://andrew.localhost), [luke.localhost](http://luke.localhost), [letters.localhost](http://letters.localhost), [ref.localhost](http://ref.localhost), [radio.localhost](http://radio.localhost), [maps.localhost](http://maps.localhost), [maps-sync.localhost/health](http://maps-sync.localhost/health), [pool.localhost](http://pool.localhost), or [artbin.localhost](http://artbin.localhost). Ref and Radio use local development passwords; set `REF_PASSWORD` and `RADIO_PASSWORD` before starting Compose to choose your own. Maps runs its UI and collaboration Workers on local Celld, and collaboration and the hosted service share `MAPS_REALTIME_TICKET_SECRET` for local signed tickets. Hosted Maps sign-in also needs a registered Jack Auth client: set `MAPS_AUTH_CLIENT_ID`, `AUTH_MAPS_PROJECT_ID`, and `AUTH_ORGANIZATION_ID` before starting the Maps service. To exercise Artbin from the Maps service, provide `TEA_MAPS_ARTBIN_URL`, `AUTH_ARTBIN_PROJECT_ID`, `AUTH_ARTBIN_CLIENT_ID`, and `AUTH_ARTBIN_CLIENT_SECRET` in the local environment; the service leaves Artbin disabled if any is missing. The service binds loopback port 8792, collaboration binds loopback port 8787, and Traefik binds loopback port 80. The Maps UI, hosted service, and collaboration ports are 8790, 8792, and 8787; stop a separate Ref dev server on port 8787 before starting Maps collaboration. Production DNS, TLS, and host setup live in the infrastructure repo.

Burger is opt-in because it needs a registered local OAuth callback. Set `BURGER_AUTH_CLIENT_ID` and `AUTH_BURGER_PROJECT_ID`, then run `docker compose --profile burger up --build -d` to open [burger.localhost](http://burger.localhost). Its [workspace guide](apps/burger/README.md) covers the isolated browser fixture when no local provider client is registered.

CI installs once and runs the `check` scripts for affected workspaces. Package changes also check their consumers; shared config or unknown paths check every workspace with a `check` script. README, `docs/`, Dockerfiles, `.dockerignore`, and the CI selector skip app checks; image builds run in the publish workflows, and the selector has its own tests. A separate [Node image check](docs/node-images.md) builds and exercises the six deployed Node images for runtime/Docker dependency changes without publishing. Draft PR updates compare only commits in that push; ready PRs and `main` check the full change set. Browser setup remains available for workspace checks that include browser tests. Separate integration browser and Celld smokes run for affected apps when a PR is ready for review or on `main`. See [`scripts/ci/affected.mjs`](scripts/ci/affected.mjs).

The [project import guide](docs/project-imports.md) records the Ref, Radio, Maps, Marky, Letters to Steve, and Artbin transfers.
The [Maps third-party notices](THIRD_PARTY_NOTICES.md) preserve attribution for the imported Maps code and test fixture.
