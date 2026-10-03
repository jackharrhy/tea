# Architecture direction

Tea starts with a wholesale TeaCMS import. The Node multi-site runtime and Cloudflare D1/R2 runtime remain distinct entry points while the shared contract is identified. Site selection, draft/publish rules, previews, and media checks are product invariants.

Each app owns its routes, runtime configuration, and deployable artifact. Shared packages expose named exports and never import from apps. We will promote code only when a second app needs the same behavior.

Remix 3 is the default web framework. Use `remix/routes` for typed URL contracts, `remix/router` for controllers and middleware, and `remix/component` for UI. Browser behavior follows a working server response. Services with their own runtime needs can remain separate applications.

The default deployment target is independent containers on the VPS. TeaCMS also retains a Cloudflare Worker path. This repository can own Dockerfiles and Worker configuration, while the separate infrastructure repository owns hosts, ingress, DNS, secrets, and live state.

References: [Remix guides](https://guides.remix.run/), [Sergio Xalambrí's monorepo](https://github.com/sergiodxa/monorepo), [The Remix Way talk](https://remix.run/jam/2026), and [Pitlane Cloudflare guide](https://pitlane.tools/deploy/cloudflare).
