# TeaCMS

Use native Remix 3 (`remix` subpath imports), not React. Read the relevant README under the Tea root's `node_modules/remix/src/` before changing framework integrations. The server uses typed routes/controllers/middleware and standard `render({ assets })`; site components receive explicit configuration.

- Work from `apps/teacms` for local scripts or use `npm run <script> --workspace teacms` from Tea's root. Use `npm run format` before committing. `npm run check` runs Oxlint, Oxfmt verification, the build and server tests; `npm run test:browser` checks the browser workflows.
- Shared runtime lives in `packages/teacms/app`; optional features have named directories. Keep presentation in `sites/*` and hostname registration in `apps/server`.
- Never commit site content, media, credentials or runtime data. Use generated fixtures and ignored `tmp/`.
- Site selection must happen before static files, auth, storage or content access. Do not add mutable process-global tenant state.
- Preserve draft/publish separation, unknown block properties, stale-write rejection and media reference checks.
- The configured canonical origin is authoritative. Analytics must remain suppressed on previews and CMS pages.
- Publishing repository changes is distinct from deploying a site. Do not alter production, DNS or other preview services without a request covering those actions.
- Migration adoption must operate on a copy and refuse overwriting a destination. Never reset production migration history in place.
