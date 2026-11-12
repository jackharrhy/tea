# Harrhy

A Remix 3 monorepo for personal apps and packages.

[WORLD_IDEA.md](WORLD_IDEA.md) records the direction for a future shared world built from Burger, Gurgur, Pool, and Worldview.
[WORLD_CINEMA_IDEA.md](WORLD_CINEMA_IDEA.md) explores an access-controlled cinema room within that world.

[npm publication](docs/npm-publication.md) describes the two public `@harrhy` packages and their release boundary.
[Shared UI direction](docs/ui.md) explains the small control foundation being proven in Ref.

### Apps

<!-- prettier-ignore -->
| Workspace | What it runs | Guide |
| --- | --- | --- |
| [`@harrhy/8mb`](apps/8mb/) | Browser video compression and opt-in aggregate diagnostics | [README](apps/8mb/README.md) |
| [`@harrhy/artbin-app`](apps/artbin/) | Game asset archive, uploads, previews, and API | [README](apps/artbin/README.md) |
| [`@harrhy/artbin`](apps/artbin-cli/) | Game asset command-line client | [README](apps/artbin-cli/README.md) |
| [`@harrhy/burger`](apps/burger/) | Remix game UI and authoritative Bun world server | [README](apps/burger/README.md) |
| [`@harrhy/cms`](apps/cms/) | Multi-site CMS, operator dashboard, and Node host | [README](apps/cms/README.md) |
| [`@harrhy/cms-edge`](apps/cms-edge/) | Cloudflare Worker CMS backed by D1 and R2 | [README](apps/cms-edge/README.md) |
| [`@harrhy/garden`](apps/garden/) | Obsidian-backed personal website and publishing tools | [README](apps/garden/README.md) |
| [`@harrhy/gurgur`](apps/gurgur/) | WebGPU world and Bun authoritative game server | [README](apps/gurgur/README.md) |
| [`@harrhy/letters-to-steve`](apps/letters-to-steve/) | Private correspondence and editorial publishing for Steve | [README](apps/letters-to-steve/README.md) |
| [`@harrhy/lists`](apps/lists/) | Mailing lists, campaigns, delivery, and inbound mail | [README](apps/lists/README.md) |
| [`@harrhy/worldview`](apps/worldview/) | Worldview BSP viewer and map editor | [README](apps/worldview/README.md) |
| [`@harrhy/marky`](apps/marky/) | Collaborative Markdown editor with Jack Auth access | [README](apps/marky/README.md) |
| [`@harrhy/pool-app`](apps/pool/) | Remix pool hall and authoritative Bun game server | [README](apps/pool/README.md) |
| [`@harrhy/maps-collaboration`](apps/maps-collaboration/) | Live map sessions and SQLite map cells | [README](apps/maps-collaboration/README.md) |
| [`@harrhy/maps-compiler`](apps/maps-compiler/) | Local native map compiler helper | [README](apps/maps-compiler/README.md) |
| [`@harrhy/maps-service`](apps/maps-service/) | Hosted map projects and API | [README](apps/maps-service/README.md) |
| [`@harrhy/ref`](apps/ref/) | Private image and link boards on a Worker and Celld | [README](apps/ref/README.md) |
| [`@harrhy/rotund`](apps/rotund/) | Personal service directory with Jack Auth entitlements | [README](apps/rotund/README.md) |
| [`@harrhy/radio`](apps/radio/) | Synchronized listening rooms on a Worker and Celld | [README](apps/radio/README.md) |

### Packages

<!-- prettier-ignore -->
| Workspace | What it provides | Guide |
| --- | --- | --- |
| [`@harrhy/artbin-core`](packages/artbin-core/) | Asset scanning, detection, and upload primitives | [README](packages/artbin-core/README.md) |
| [`@harrhy/artbin-ui`](packages/artbin-ui/) | CLI scan interface components | [README](packages/artbin-ui/README.md) |
| [`@harrhy/burger-core`](packages/burger-core/) | Shared Burger ECS, physics, and wire constants | [README](packages/burger-core/README.md) |
| [`@harrhy/dev-auth`](packages/dev-auth/) | Disposable local Jack Auth protocol issuer for app development | [README](packages/dev-auth/README.md) |
| [`@harrhy/identity`](packages/identity/) | Jack Auth OIDC and API identity verification | [README](packages/identity/README.md) |
| [`@harrhy/gurgur-engine`](packages/gurgur-engine/) | Gurgur Box3D physics, protocol and world format | [README](packages/gurgur-engine/README.md) |
| [`@harrhy/gurgur-game`](packages/gurgur-game/) | Gurgur controllers, simulation and map compiler | [README](packages/gurgur-game/README.md) |
| [`@harrhy/json-schema`](packages/json-schema/) | Remix data schemas with JSON Schema descriptions | [README](packages/json-schema/README.md) |
| [`@harrhy/logger`](packages/logger/) | Request and job logging primitives | [README](packages/logger/README.md) |
| [`@harrhy/maps-editor`](packages/maps-editor/) | Map document and source-rendering primitives | [README](packages/maps-editor/README.md) |
| [`@harrhy/maps-protocol`](packages/maps-protocol/) | Hosted and collaborative map schemas | [README](packages/maps-protocol/README.md) |
| [`@harrhy/worldview-renderer`](packages/maps-renderer/) | Embeddable WebGPU map renderer and BSP core | [README](packages/maps-renderer/README.md) |
| [`@harrhy/mcp`](packages/mcp/) | MCP tools, resources, and Streamable HTTP handler | [README](packages/mcp/README.md) |
| [`@harrhy/pool`](packages/pool/) | Shared pool rules, Box3D physics, and recordings | [README](packages/pool/README.md) |
| [`@harrhy/pool-protocol`](packages/pool-protocol/) | Versioned pool WebSocket messages | [README](packages/pool-protocol/README.md) |
| [`@harrhy/pool-simulation`](packages/pool-simulation/) | Hall movement and navigation | [README](packages/pool-simulation/README.md) |
| [`@harrhy/request-body`](packages/request-body/) | Bounded Web request-body reading | [README](packages/request-body/README.md) |
| [`@harrhy/result`](packages/result/) | Success and failure values and helpers | [README](packages/result/README.md) |
| [`@harrhy/rich-text`](packages/rich-text/) | Inline document format and rich text editor | [README](packages/rich-text/README.md) |
| [`@harrhy/ui`](packages/ui/) | Themeable Remix control styles, starting with Ref | [README](packages/ui/README.md) |

## Working in the repo

Use Node.js 26 LTS (`.nvmrc` and `mise.toml`; minimum 26.13.0) for monorepo development and CI. The published Artbin CLI retains its separate Node 20+ consumer support. Install from the root:

```sh
npm ci
```

Run workspace scripts with `npm run <script> --workspace <name>`. For example, `npm run dev --workspace @harrhy/cms` starts CMS. Run `npm run` for root scripts, including `npm run artbin:check`, `npm run cms:check`, `npm run letters-to-steve:check`, `npm run ref:check`, `npm run radio:check`, and `npm run worldview:check`. Each workspace README has its own setup and checks.

Vite+ runs Oxfmt and Oxlint from [`vite.config.ts`](vite.config.ts). `npm run tooling:check` builds the three importable Maps packages, generates missing Worker types, then checks formatting and type-aware lint through tsrslint. `npm run format` formats files. `npm run knip:check` runs the full unused-code audit in CI. The [Knip config](knip.jsonc) lists browser, Worker, public package, and other entry points that are not visible through imports. Review Knip findings before deleting code.

Workspace `typecheck` and declaration/build scripts use tsrs. `npm run typecheck:tsrs` checks every workspace after Worker types have been generated. `npm run lint` runs the same type-aware Oxlint configuration used in CI.

The local [`compose.yml`](compose.yml) runs Traefik and the containerized apps. Run `docker compose up --build -d`, then open [andrew.localhost](http://andrew.localhost), [luke.localhost](http://luke.localhost), [letters.localhost](http://letters.localhost), [ref.localhost](http://ref.localhost), [radio.localhost](http://radio.localhost), [maps.localhost](http://maps.localhost), [maps-sync.localhost/health](http://maps-sync.localhost/health), [pool.localhost](http://pool.localhost), or [artbin.localhost](http://artbin.localhost). Ref and Radio use local development passwords; set `REF_PASSWORD` and `RADIO_PASSWORD` before starting Compose to choose your own. Maps runs its UI and collaboration Workers on local Celld, and collaboration and the hosted service share `MAPS_REALTIME_TICKET_SECRET` for local signed tickets. Hosted Maps sign-in also needs a registered Jack Auth client: set `MAPS_AUTH_CLIENT_ID`, `AUTH_MAPS_PROJECT_ID`, and `AUTH_ORGANIZATION_ID` before starting the Maps service. To exercise Artbin from the Maps service, provide `TEA_MAPS_ARTBIN_URL`, `AUTH_ARTBIN_PROJECT_ID`, `AUTH_ARTBIN_CLIENT_ID`, and `AUTH_ARTBIN_CLIENT_SECRET` in the local environment; the service leaves Artbin disabled if any is missing. The service binds loopback port 8792, collaboration binds loopback port 8787, and Traefik binds loopback port 80. The Maps UI, hosted service, and collaboration ports are 8790, 8792, and 8787; stop a separate Ref dev server on port 8787 before starting Maps collaboration. Production DNS, TLS, and host setup live in the infrastructure repo.

Burger is opt-in because it needs a registered local OAuth callback. Set `BURGER_AUTH_CLIENT_ID` and `AUTH_BURGER_PROJECT_ID`, then run `docker compose --profile burger up --build -d` to open [burger.localhost](http://burger.localhost). Its [workspace guide](apps/burger/README.md) covers the isolated browser fixture when no local provider client is registered.

Lists uses a separate local profile with Moto and Mailpit: run `docker compose --profile lists up --build --wait lists`, then open [localhost:18080](http://localhost:18080). See the [Lists local stack guide](apps/lists/LOCAL_DEVELOPMENT.md).

CI installs once and runs the `check` scripts for affected workspaces. Package changes also check their consumers; shared config or unknown paths check every workspace with a `check` script. README, `docs/`, Dockerfiles, `.dockerignore`, and the CI selector skip app checks; image builds run in the publish workflows, and the selector has its own tests. A separate [Node image check](docs/node-images.md) builds and exercises the six deployed Node images for runtime/Docker dependency changes without publishing. Draft PR updates compare only commits in that push; ready PRs and `main` check the full change set. Browser setup remains available for workspace checks that include browser tests. Separate integration browser and Celld smokes run for affected apps when a PR is ready for review or on `main`. See [`scripts/ci/affected.mjs`](scripts/ci/affected.mjs).

The [project import guide](docs/project-imports.md) records the Ref, Radio, Maps, Marky, Letters to Steve, and Artbin transfers.
The [Maps third-party notices](THIRD_PARTY_NOTICES.md) preserve attribution for the imported Maps code and test fixture.
