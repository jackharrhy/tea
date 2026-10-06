# Architecture

Tea is a Remix 3 monorepo of independently deployable apps and importable packages, listed in the [root README](../README.md). Apps own runtime configuration and deployment artifacts. Packages use named workspace imports and never import apps. A package can serve just one product.

Use `remix/routes` for typed URLs, `remix/router` for controllers and middleware, and `remix/component` for UI. Start with a working server response, then add browser behavior. Node and Cloudflare hosts use Remix 3 with their own runtime adapters and storage.

## Apps today

`apps/cms` owns the Node CMS: routes, storage, editor, operator dashboard, and site presentations in `sites/<id>`. It registers each site's presentation, manifest, and assets at startup, then exports presentations by subpath. `apps/cms-edge` is a separate Cloudflare Worker CMS with D1 and R2 storage. `packages/rich-text` owns TipTap and the Inline document format. Site selection, draft/publish rules, previews, and media checks belong to each CMS app.

`apps/shell-mcp` owns the Shell MCP routes, tools, job lifecycle, Node listener, 4orm identity provider, and optional systemd runner. Both Shell MCP and CMS use `@tea/mcp` for transport. The local Compose service runs locked; the live Newport host remains on its existing systemd deployment. See the [app guide](../apps/shell-mcp/README.md).

Root [`compose.yml`](../compose.yml) runs local containers behind Traefik on `.localhost`. Independent VPS containers are the default deployment target; CMS also has a Cloudflare Worker path, and a live Shell MCP deployment can use host systemd units for bounded execution. This repo owns app Dockerfiles and Worker configuration; the infrastructure repo owns production routing, DNS, secrets, host units, and live state.

References: [Remix guides](https://guides.remix.run/), [Sergio Xalambrí's monorepo](https://github.com/sergiodxa/monorepo), [The Remix Way talk](https://remix.run/jam/2026), [Pitlane Cloudflare guide](https://pitlane.tools/deploy/cloudflare).
