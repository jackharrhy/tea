# tea

a Remix 3 monorepo for personal apps and packages.

### Apps

<!-- prettier-ignore -->
| Workspace | What it runs | Guide |
| --- | --- | --- |
| [`@tea/cms`](apps/cms/) | Multi-site CMS, operator dashboard, and Node host | [README](apps/cms/README.md) |
| [`@tea/cms-edge`](apps/cms-edge/) | Cloudflare Worker CMS backed by D1 and R2 | [README](apps/cms-edge/README.md) |
| [`@tea/letters-to-steve`](apps/letters-to-steve/) | Private correspondence and editorial publishing for Steve | [README](apps/letters-to-steve/README.md) |
| [`@tea/maps`](apps/maps/) | Remix 3 BSP viewer and map editor | [README](apps/maps/README.md) |
| [`@tea/marky`](apps/marky/) | Collaborative Markdown editor with Discord access | [README](apps/marky/README.md) |
| [`@tea/maps-collaboration`](apps/maps-collaboration/) | Live map sessions and SQLite map cells | [README](apps/maps-collaboration/README.md) |
| [`@tea/maps-compiler`](apps/maps-compiler/) | Local native map compiler helper | [README](apps/maps-compiler/README.md) |
| [`@tea/maps-service`](apps/maps-service/) | Hosted map projects and API | [README](apps/maps-service/README.md) |
| [`@tea/ref`](apps/ref/) | Private image and link boards on a Worker and Celld | [README](apps/ref/README.md) |
| [`@tea/radio`](apps/radio/) | Synchronized listening rooms on a Worker and Celld | [README](apps/radio/README.md) |
| [`@tea/shell-mcp`](apps/shell-mcp/) | Shell MCP, job lifecycle, and Node host | [README](apps/shell-mcp/README.md) |

### Packages

<!-- prettier-ignore -->
| Workspace | What it provides | Guide |
| --- | --- | --- |
| [`@tea/json-schema`](packages/json-schema/) | Remix data schemas with JSON Schema descriptions | [README](packages/json-schema/README.md) |
| [`@tea/logger`](packages/logger/) | Request and job logging primitives | [README](packages/logger/README.md) |
| [`@tea/maps-editor`](packages/maps-editor/) | Map document and source-rendering primitives | [README](packages/maps-editor/README.md) |
| [`@tea/maps-protocol`](packages/maps-protocol/) | Hosted and collaborative map schemas | [README](packages/maps-protocol/README.md) |
| [`@tea/maps-renderer`](packages/maps-renderer/) | Embeddable WebGPU map renderer and BSP core | [README](packages/maps-renderer/README.md) |
| [`@tea/mcp`](packages/mcp/) | MCP tools, resources, and Streamable HTTP handler | [README](packages/mcp/README.md) |
| [`@tea/request-body`](packages/request-body/) | Bounded Web request-body reading | [README](packages/request-body/README.md) |
| [`@tea/result`](packages/result/) | Success and failure values and helpers | [README](packages/result/README.md) |
| [`@tea/rich-text`](packages/rich-text/) | Inline document format and rich text editor | [README](packages/rich-text/README.md) |

## Working in the repo

Use the latest Node.js 24 LTS release (`.nvmrc`; minimum 24.3). Install from the root:

```sh
npm ci
```

Run workspace scripts with `npm run <script> --workspace <name>`. For example, `npm run dev --workspace @tea/cms` starts CMS. Run `npm run` for root scripts, including `npm run cms:check`, `npm run letters-to-steve:check`, `npm run ref:check`, `npm run radio:check`, and `npm run maps:check`. Each workspace README has its own setup and checks.

Vite+ runs the shared format and lint checks from [`vite.config.ts`](vite.config.ts). Run `npm run tooling:check` for both, or `npm run format` to format files. Run `npm run knip` to audit unused code and dependencies across workspaces. Knip currently reports findings, so it is a manual audit rather than a CI gate; review results before changing code.

The local [`compose.yml`](compose.yml) runs Traefik and the containerized apps. Run `docker compose up --build -d`, then open [andrew.localhost](http://andrew.localhost), [luke.localhost](http://luke.localhost), [letters.localhost](http://letters.localhost), [ref.localhost](http://ref.localhost), [radio.localhost](http://radio.localhost), [maps.localhost](http://maps.localhost), [maps-sync.localhost/health](http://maps-sync.localhost/health), or [shell.localhost/healthz](http://shell.localhost/healthz). The shell container runs in locked mode; it cannot execute commands. Ref and Radio use local development passwords; set `REF_PASSWORD` and `RADIO_PASSWORD` before starting Compose to choose your own. Maps runs its UI and collaboration Workers on local Celld, and collaboration and the hosted service share `MAPS_REALTIME_TICKET_SECRET` for local signed tickets. To exercise Artbin from the Maps service, provide `TEA_MAPS_ARTBIN_URL`, `TEA_MAPS_ARTBIN_CLIENT_ID`, and `TEA_MAPS_ARTBIN_CLIENT_SECRET` in the local environment; the service leaves Artbin disabled if any is missing. The service binds loopback port 8792, collaboration binds loopback port 8787, and Traefik binds loopback port 80. The Maps UI, hosted service, and collaboration ports are 8790, 8792, and 8787; stop a separate Ref dev server on port 8787 before starting Maps collaboration. Production DNS, TLS, and host setup live in the infrastructure repo.

CI installs once and runs the `check` scripts for affected workspaces. Package changes also check their consumers; shared config or unknown paths check every workspace with a `check` script. README and `docs/` changes skip app checks. Draft PR updates compare only commits in that push; ready PRs and `main` check the full change set. Browser setup remains available for workspace checks that include browser tests. Separate integration browser and Celld smokes run for affected apps when a PR is ready for review or on `main`. See [`scripts/ci/affected.mjs`](scripts/ci/affected.mjs).

The [project import guide](docs/project-imports.md) records the Ref, Radio, Maps, Marky, and Letters to Steve transfers.
The [Worldview third-party notices](THIRD_PARTY_NOTICES.md) preserve attribution for the imported Maps code and test fixture.
