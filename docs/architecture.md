# Architecture

Tea is a Remix 3 monorepo of independently deployable apps and importable packages, listed in the [root README](../README.md). Apps own runtime configuration and deployment artifacts. Packages use named workspace imports and never import apps. A package can serve just one product.

Use `remix/routes` for typed URLs, `remix/router` for controllers and middleware, and `remix/component` for UI. Start with a working server response, then add browser behavior. Node and Cloudflare hosts use Remix 3 with their own runtime adapters and storage.

## Apps today

`apps/cms` owns the Node CMS: routes, storage, editor, operator dashboard, and site presentations in `sites/<id>`. It registers each site's presentation, manifest, and assets at startup, then exports presentations by subpath. `apps/cms-edge` is a separate Cloudflare Worker CMS with D1 and R2 storage. `packages/rich-text` owns TipTap and the Inline document format. Site selection, draft/publish rules, previews, and media checks belong to each CMS app.

`packages/mcp` provides Streamable HTTP transport and MCP tools and resources for CMS and other consumers. Each app owns its own routes, authentication, and runtime policy.

Root [`compose.yml`](../compose.yml) runs local containers behind Traefik on `.localhost`. Independent VPS containers are the default deployment target; CMS also has a Cloudflare Worker path. This repo owns app Dockerfiles and Worker configuration; the infrastructure repo owns production routing, DNS, secrets, host units, and live state.

References: [Remix guides](https://guides.remix.run/), [Sergio Xalambrí's monorepo](https://github.com/sergiodxa/monorepo), [The Remix Way talk](https://remix.run/jam/2026), [Pitlane Cloudflare guide](https://pitlane.tools/deploy/cloudflare).
