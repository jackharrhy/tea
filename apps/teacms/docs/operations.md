# Runtime and deployment

The intended default is one container with one Node process and one database/upload tree per site. A process restart or failure affects every site in that process. Separate data makes per-site backup/restore possible, but does not provide process or security isolation from code running inside the same server.

Each `sites/<id>/site.json` owns its public name, canonical origin, aliases, preview status, and optional features. An ignored `site.local.json` in the same directory can override these values for a local or deployment-specific instance. The optional operator dashboard uses `TEA_OPERATOR_ORIGIN` as a process-level routing setting. The server discovers sites at startup; adding a site requires a manifest and a presentation module at `app/site.ts`.

## Docker

```sh
docker build -f apps/teacms/Dockerfile -t teacms:local .
```

The image runs as the Node user (UID 1000). Bind-mounted data directories must be writable by that UID. It listens on container port 4351. Mount site-specific `site.local.json` files only when their origins differ from the tracked manifests. Configure `TEA_DATA_DIR` as writable persistent storage. Keep the backend on the private proxy network.

Run the build from Tea's root. `apps/teacms/deploy/compose.example.yml` is a generic application example. Host networks, Traefik routers, DNS, certificate configuration, and live volumes belong in the separate infrastructure repository.

## Traefik responsibilities

Explicit Host rules admit registered domains and forward them to the same TeaCMS backend. The original Host is passed through. TeaCMS selects the site and handles alias redirects; unknown hosts get 404. Behind TLS termination it uses the configured origin rather than trusting forwarded host/protocol headers. Do not expose the backend directly on a public port.

Run `npm run tea:traefik -- <certificate-resolver>` from `apps/teacms` to generate candidate Traefik file-provider routers from the tracked site manifests. Review and place the output through the infrastructure repository. Re-run it and restart TeaCMS when site origins change. Configure the operator dashboard router separately using `TEA_OPERATOR_ORIGIN`; it is an infrastructure endpoint, not a site. The operator dashboard provides authenticated site entry, health, and metadata; it does not provision domains, change DNS, or access the Docker socket.

References: [Traefik routers](https://doc.traefik.io/traefik/reference/routing-configuration/http/routing/router/), [file provider](https://doc.traefik.io/traefik/reference/install-configuration/providers/others/file/), [host forwarding](https://doc.traefik.io/traefik/reference/routing-configuration/http/load-balancing/service/).

## Health and backups

`GET /healthz` on each configured hostname verifies that site's database connection. Monitor sites individually. For example:

```sh
curl -H 'Host: andrew.example.com' http://127.0.0.1:4351/healthz
```

Do not copy only a live WAL-mode `tea.db` file. Use SQLite's backup operation or stop writes and take a consistent database/upload backup. Retain off-host copies and exercise restores. Adoption is migration tooling, not a scheduled backup service.

The separate `data/operator/operator.db` contains operator password hashes, sessions, and site-entry tickets. Include it in protected backups or deliberately reseed an operator after a restore.

Site sessions, rate-limit state and file lookups are scoped to the selected site's stores. Cookies are named by site ID because ports on a shared hostname do not isolate browser cookies. Editors sign in independently. Operator credentials, sessions, and one-time entry tickets live in a separate operator database; signing out there invalidates operator-issued site sessions. A shared server makes independent data isolation tests necessary; `test/tenants.test.ts` and `test/operator.test.ts` cover the principal boundaries.

## Scope of this repository

The shared CMS, optional features, two presentations, tenant dispatcher, analytics settings, operator dashboard, adoption command and deployment examples are implemented. Automated domain provisioning is later work. This repository does not own VPS configuration, DNS, or a production service.
