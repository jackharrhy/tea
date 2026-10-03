# Tea

A workspace for independently deployable personal projects. TeaCMS is the first app.

Requires Node.js 24.3 or newer. From the repository root:

```sh
npm install
npm run dev:teacms
npm run check:teacms
```

`apps/teacms` contains the imported TeaCMS Node app, reusable CMS package, Cloudflare edge package, and site examples. Its [README](apps/teacms/README.md) and [operations guide](apps/teacms/docs/operations.md) cover application setup. The source repository remains at `../teacms`; this import does not change its deployment.

`npm run check:teacms-edge` validates the [Cloudflare Worker example](apps/teacms/apps/edge-example/README.md). The Node app includes an optional [read-only MCP endpoint](apps/teacms/docs/mcp.md).

## Boundaries

- `apps/` holds deployable products and their own entry points.
- `packages/` is for code with a demonstrated contract across products.
- App-local packages may stay inside an app while their ownership is specific to that product.
- Deployment manifests may live here; host inventory, DNS, secrets, and production state belong in the separate infrastructure repository.

See [architecture notes](docs/architecture.md) for the migration direction.
