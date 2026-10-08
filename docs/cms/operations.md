# Runtime and deployment

One container and Node process serve all sites. Each site has its own database and upload tree, so it can be backed up and restored separately. A process restart or failure affects every site, and code in that process shares a security boundary.

Each `apps/cms/sites/<id>/site.json` sets the site's name, canonical origin, aliases, preview status, and optional features. An ignored `site.local.json` beside it can override those settings locally or for a deployment. The optional operator dashboard uses process-level `TEA_OPERATOR_ORIGIN`. The server finds site folders at startup; each needs a manifest and `app/site.ts` presentation.

## Local Docker stack

From the repo root:

```sh
docker compose up --build -d
```

Root [`compose.yml`](../../compose.yml) runs Traefik and CMS. Open `http://andrew.localhost` or `http://luke.localhost`. Traefik binds port 80 on loopback and forwards to CMS port 4351 over the Compose network. CMS publishes no host port. The `cms-data` volume persists data between runs.

`docker compose down` stops the stack and keeps the volume.

Compose mounts inline `site.local.json` overrides for the `.localhost` hosts; tracked manifests stay as they are. The image runs as Node user UID 1000, so bind-mounted data must be writable by that user. Production routing, TLS, DNS, secrets, and volume backups belong in the infrastructure repo.

## Traefik

Compose labels give each site an HTTP router pointing to the same CMS service. Keep the labels and inline local origins in sync. Traefik forwards the original Host; TeaCMS selects the site and redirects aliases. Unknown hosts get 404.

The local stack does not enable the optional operator dashboard. If you set `TEA_OPERATOR_ORIGIN`, add a Traefik router label for that host. The dashboard handles authenticated site entry, health, and metadata. It does not provision domains, change DNS, or access the Docker socket.

References: [Traefik Docker routing](https://doc.traefik.io/traefik/reference/routing-configuration/other-providers/docker/), [HTTP routers](https://doc.traefik.io/traefik/reference/routing-configuration/http/routing/router/).

## Mug preview deployment

The [Publish CMS workflow](../../.github/workflows/publish-cms.yml) runs when a push to `main` changes `apps/cms`, its shared packages, or the image build inputs. It checks the CMS and publishes `ghcr.io/jackharrhy/tea-cms:latest` and a commit tag. A manual run from `main` is also available:

```sh
gh workflow run publish-cms.yml --ref main
```

Mug's `teacms` Compose service uses `:latest`, and Watchtower pulls new images from private GHCR using its mounted Docker registry credentials. The existing `/app/data` mount holds the Andrew and Luke preview content and operator account. Watchtower recreates only the CMS container when a new image is published; check all three preview hosts after a rollout. For rollback, set the service image to a known commit tag or digest in infra and run `infra refresh mug --service teacms`. Andrew's production website uses a different Compose service and is outside this rollout.

## Health and backups

`GET /healthz` checks the selected site's database. Monitor each site:

```sh
curl http://andrew.localhost/healthz
```

Do not copy a live WAL-mode `tea.db` alone. Use SQLite backup, or stop writes and back up the database and uploads together. Keep off-host copies and test restores.

`data/operator/operator.db` holds operator password hashes, sessions, and site-entry tickets. Back it up securely or reseed an operator after restoring.

Each site's stores scope sessions, rate limits, and file lookups. Cookies include the site ID because browser cookies do not isolate ports on one hostname. Editors sign in separately. The operator database holds its credentials, sessions, and one-time entry tickets; operator sign-out invalidates operator-issued site sessions. `apps/cms/__tests__/tenants.test.ts` and `apps/cms/__tests__/operator.test.ts` test the main isolation boundaries of the shared server.

## Scope of this repository

This repo has the shared CMS, optional features, two site presentations, tenant dispatcher, analytics settings, operator dashboard, and deployment examples. Automated domain provisioning remains future work. VPS configuration, DNS, and production services live elsewhere.
