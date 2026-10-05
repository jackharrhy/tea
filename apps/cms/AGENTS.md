# TeaCMS

Use native Remix 3 through `remix` subpath imports, not React. Before changing framework integrations, read the relevant README under root `node_modules/remix/src/`. The server uses typed routes, controllers, middleware, and `render({ assets })`. Pass configuration explicitly to site components.

- Run app commands from `apps/cms` or use `npm run <script> --workspace @tea/cms` from the root. Root `npm run check:cms` runs lint, format, build, and server tests. `npm run test:browser --workspace @tea/cms` checks browser workflows. Scripts are in `scripts/cms`; host tests and fixtures are in `apps/cms/__tests__/`; package tests sit near their code.
- Shared runtime lives in `packages/cms-core/app`, with named directories for optional features. Keep each site's presentation, manifest, and assets in `apps/cms/sites/<id>`. Register hostnames in `apps/cms/config.ts` and export presentations through `@tea/cms/sites/<id>`.
- Never commit site content, media, credentials, or runtime data. Use generated fixtures and ignored `tmp/`.
- Select the site before static files, auth, storage, or content access. Avoid mutable process-global tenant state.
- Preserve draft/publish separation, unknown block properties, stale-write rejection, and media reference checks.
- The configured canonical origin is authoritative. Analytics must remain suppressed on previews and CMS pages.
- Publishing repo changes and deploying a site are separate actions. Do not change production, DNS, or other preview services without a request for them.
