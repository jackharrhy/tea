# Verification of the initial extraction

Validated locally on 22 September 2026 with Node 24:

- TypeScript checking and 135 compiled browser modules, including the shared editor, adornment library and Luke navigation editor.
- 24 server tests: draft/publish separation, stale writes, retained unknown fields, media/path safety, HEAD semantics, authentication, tenant isolation, capability gating, SEO/analytics and data adoption.
- Two end-to-end browser workflows, one per presentation: login, native editor hydration, private draft, publication, navigation, persisted analytics settings and mobile/desktop layout. Andrew's Riso copy-colour behaviour is exercised. No browser script errors.
- Original Andrew and Luke migration SQL applied to empty temporary databases, then successfully adopted into the shared schema. No existing site data was used.
- Docker image built with a clean dependency installation and production pruning; both configured sites answered their health endpoints in a loopback-only container.
- Dependency audit reported zero vulnerabilities for the retained lockfile at verification time.

These checks validate the extraction with generated content. They do not replace a visual/content review of a restored real site before a future cutover. Existing services, media compatibility routing, DNS and preview listeners were not changed.
