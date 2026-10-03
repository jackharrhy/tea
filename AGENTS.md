# Tea

Tea is a workspace of independently deployable personal apps. Apps compose packages; packages never import from apps. Keep product-specific behavior with its app until there is a proven shared contract.

The first app is TeaCMS in `apps/teacms`. Read its `AGENTS.md` before changing it. Keep its tenant selection before static files, auth, storage, and content access. Do not commit content, media, credentials, or runtime data.

Use the stable Remix 3 package and its current guides for web app changes. Native Remix components use `remix/component`; routes, controllers, and middleware own HTTP behavior. Avoid introducing React into TeaCMS.

Deployment definitions live with the apps. Host configuration, DNS, secrets, and production operations live in a separate repository.
