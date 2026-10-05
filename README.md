# tea

a Remix 3 monorepo for personal apps and packages.

### Apps

<!-- prettier-ignore -->
| Workspace | What it runs | Guide |
| --- | --- | --- |
| [`@tea/cms`](apps/cms/) | Node host for the multi-site CMS | [README](apps/cms/README.md) |
| [`@tea/shell-mcp`](apps/shell-mcp/) | Node host for Shell MCP | [README](apps/shell-mcp/README.md) |

### Packages

<!-- prettier-ignore -->
| Workspace | What it provides | Guide |
| --- | --- | --- |
| [`@tea/cms-core`](packages/cms-core/) | Node CMS routes, content storage, auth, media, and MCP | [README](packages/cms-core/README.md) |
| [`@tea/cms-edge`](packages/cms-edge/) | CMS runtime, content APIs, and a Worker host example | [README](packages/cms-edge/README.md) |
| [`@tea/cms-operator`](packages/cms-operator/) | Dashboard for the Node CMS host | [README](packages/cms-operator/README.md) |
| [`@tea/json-schema`](packages/json-schema/) | Remix data schemas with JSON Schema descriptions | [README](packages/json-schema/README.md) |
| [`@tea/logger`](packages/logger/) | Request and job logging primitives | [README](packages/logger/README.md) |
| [`@tea/mcp`](packages/mcp/) | MCP tools, resources, and Streamable HTTP handler | [README](packages/mcp/README.md) |
| [`@tea/request-body`](packages/request-body/) | Bounded Web request-body reading | [README](packages/request-body/README.md) |
| [`@tea/result`](packages/result/) | Success and failure values and helpers | [README](packages/result/README.md) |
| [`@tea/rich-text`](packages/rich-text/) | Inline document format and rich text editor | [README](packages/rich-text/README.md) |
| [`@tea/shell-core`](packages/shell-core/) | Shell jobs, MCP tools, routes, and transport | [README](packages/shell-core/README.md) |

## Working in the repo

Use the latest Node.js 24 LTS release (`.nvmrc`; minimum 24.3). Install from the root:

```sh
npm ci
```

Run workspace scripts with `npm run <script> --workspace <name>`. For example, `npm run dev --workspace @tea/cms` starts CMS. Run `npm run` for root scripts, including `npm run check:cms`. Each workspace README has its own setup and checks.

Vite+ runs the shared format and lint checks from [`vite.config.ts`](vite.config.ts). Run `npm run check:tooling` for both, or `npm run format` to format files. Run `npm run knip` to audit unused code and dependencies across workspaces. Knip currently reports findings, so it is a manual audit rather than a CI gate; review results before changing code.

The local [`compose.yml`](compose.yml) runs Traefik and the containerized apps. Run `docker compose up --build -d`, then open [andrew.localhost](http://andrew.localhost), [luke.localhost](http://luke.localhost), or [shell.localhost/healthz](http://shell.localhost/healthz). The shell container runs in locked mode; it cannot execute commands. Only Traefik binds a host port, on loopback. Add a service and labels for each new containerized app. Production DNS, TLS, and host setup live in the infrastructure repo.

CI follows workspace dependencies: package changes also check affected apps. Shared config or unknown paths run all checks. README and `docs/` changes skip app checks. See [`scripts/ci/affected.mjs`](scripts/ci/affected.mjs).
