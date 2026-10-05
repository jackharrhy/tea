# Architecture

Tea is a Remix 3 monorepo of independently deployable apps and importable packages, listed in the [root README](../README.md). Apps own runtime configuration and deployment artifacts. Packages use named workspace imports and never import apps. A package can serve just one product.

Use `remix/routes` for typed URLs, `remix/router` for controllers and middleware, and `remix/component` for UI. Start with a working server response, then add browser behavior. Node and Cloudflare hosts use Remix 3 with their own runtime adapters and storage.

## TeaCMS today

`apps/cms` hosts multiple sites in Node and keeps each presentation in `sites/<id>`. The app registers each site's presentation, manifest, and assets at startup, then exports presentations by subpath. `packages/cms-core`, `packages/cms-operator`, and `packages/cms-edge` expose CMS modules; `packages/cms-edge/example` shows a Worker host. `packages/rich-text` owns TipTap and the Inline document format. Site selection, draft/publish rules, previews, and media checks belong to CMS.

Root [`compose.yml`](../compose.yml) runs local containers behind Traefik on `.localhost`. Production targets independent VPS containers, configured in the infrastructure repo. CMS also has a Cloudflare Worker path. This repo owns Dockerfiles and Worker configuration; the infrastructure repo owns production routing, DNS, secrets, and live state.

References: [Remix guides](https://guides.remix.run/), [Sergio Xalambrí's monorepo](https://github.com/sergiodxa/monorepo), [The Remix Way talk](https://remix.run/jam/2026), [Pitlane Cloudflare guide](https://pitlane.tools/deploy/cloudflare).
