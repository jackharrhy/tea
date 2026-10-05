# TeaCMS

This Remix 3 Node app hosts the multi-site CMS. It selects sites by hostname and uses [`@tea/cms-core`](../../packages/cms-core/README.md), [`@tea/cms-operator`](../../packages/cms-operator/README.md), and [`@tea/rich-text`](../../packages/rich-text/README.md). Andrew and Luke each keep their presentation and assets under `sites/`, exported as `@tea/cms/sites/andrew` and `@tea/cms/sites/luke`.

`server.ts` starts the server, `config.ts` registers sites and origins, and `app.ts` connects each site to its router. Keep site code and assets in `sites/<id>/`. This app owns host configuration and deployment; packages own the CMS runtime and reusable modules.

The Node host opens a request record through [`@tea/logger`](../../packages/logger/README.md). MCP handlers enrich that record. Request bodies, headers, and raw URLs are not logged.

## Develop

Use the latest Node.js 24 LTS release (minimum 24.3). From the repo root:

```sh
npm ci
npm run cms:dev
```

Checks:

```sh
npm run cms:check
npx playwright install chromium
npm run test:browser --workspace @tea/cms
```

Host tests and fixtures live in `__tests__/`; package tests live beside their code. Operational scripts live in `scripts/cms/`. See [Compose](../../compose.yml) and [operations](../../docs/cms/operations.md) for deployment and data, [MCP](../../docs/cms/mcp.md) for the optional read-only endpoint, and [AGENTS.md](AGENTS.md) for CMS editing rules.
