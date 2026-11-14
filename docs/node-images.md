# Node container checks

The deployed Node apps use prebuilt `platformatic/node-caged:26-slim` in both stages (Debian Trixie). Local development and CI use Node 26 LTS through the root `.nvmrc`. The runtime creates `node` explicitly at UID/GID 1000 because this base does not provide that account.

<!-- prettier-ignore -->
| Dockerfile under `apps/` | Runtime | Short image / scope |
| --- | --- | --- |
| `cms` | Node + `remix/node-tsx`, built-in SQLite | `teacms`, Mug |
| `auth` | Node + Remix, built-in SQLite | `auth`, Newport |
| `artbin` | Node + `remix/node-tsx`, better-sqlite3, sharp, Chromium | `artbin`, Newport |
| `letters-to-steve` | `npm start` → Node + `remix/node-tsx`, built-in SQLite, sharp | `letters-to-steve`, Newport |
| `marky` | `npm start` → Node + `remix/node-tsx`, filesystem/Git/WebSocket | `marky`, Newport |
| `rotund` | Node + Remix, static face and favicon | `rotund`, Newport |
| `8mb` | Node + Remix, local media workers and opt-in aggregate SQLite | `8mb`, Mug |
| `maps-service` | Node, built-in SQLite | `worldview-service`, Newport |
| `maps-compiler` | Node; external native executables are not bundled | `worldview-compiler`, Newport (including Gower instance) |
| `maps` | Celld Worker; Node builds/deploys it | `worldview`, Newport |
| `maps-collaboration` | Celld Worker; Node builds/deploys it | `worldview-collaboration`, Newport |
| `ref` | Celld Worker; Node builds/deploys it | `ref`, Newport |
| `radio` | Celld Worker; Node builds/deploys it | `radio`, Newport |

The table covers Node-hosted apps and the Celld Workers built with Node 26. Burger, Gurgur, and Pool also use Node 26 in their build stages and Bun in their runtime stages. The published Artbin CLI remains compatible with Node 20+ for consumers; Harrhy builds and checks it on Node 26. All short images use `ghcr.io/jackharrhy/`. Keep previous image packages and their tags available for rollback until each runtime is switched and accepted.

## Native modules

The current better-sqlite3 13 package uses N-API, unlike older V8/NAN releases. Nevertheless, builders that install it remove its prebuilds and invoke npm's bundled node-gyp directly with `--nodedir=/usr/local --jobs=2`. This uses the compression-enabled headers/config shipped with the actual runtime, does not download stock Node headers, and ensures the rebuilt binding is loaded instead of a preferred prebuild. Sharp remains on its N-API binary. Keep the SQLite write/reopen and sharp encode/decode checks when updating either dependency. Do not assume a matching Node module ABI alone makes a V8/NAN addon safe.

Artbin's selected install also includes root dev tools: its renderer build needs the root `tsrs` executable. Workspace selection and production pruning otherwise remain intact.

## Reproduce

```sh
app=artbin # cms, auth, letters-to-steve, marky, rotund, 8mb, maps-service, maps-compiler
docker build -f "apps/$app/Dockerfile" -t tea-smoke .
node scripts/ci/node-image-smoke.mjs "$app" tea-smoke
# The same compiler image also serves Gower:
node scripts/ci/node-image-smoke.mjs maps-compiler tea-smoke gower
```

The smoke starts the real image command with no host mounts, ports or network, then checks Node 26, pointer compression, UID, loader startup, HTTP/auth boundaries and applicable migrated databases/native bindings. Disposable container layers are removed even on assertion failure. Compiler checks deliberately assert unconfigured health/compile responses: they do not call production toolchains, OAuth, game launches or remote services.

The repository-owned Node images workflow selects from nine images on every PR,
then builds affected images serially without publishing. All nine named matrix
checks remain present; unselected rows skip Docker work. The selector includes
before/after transitive workspace dependencies and explicit Docker context inputs.
CMS, Maps service and Maps compiler currently copy the whole repository into their
images, so any nonempty change still selects those three. Root/runtime inputs,
unknown workspaces, comparison errors and manual dispatch select all nine.
An empty diff selects none. Run `node --test scripts/ci/__tests__/*.test.mjs`
for selector regressions; narrowing whole-repository Dockerfiles is separate work. The Rotund smoke reaches its actual compiled server over HTTP and checks the original face and favicon byte hashes. The 8mb smoke checks the editor and diagnostics request boundary. It never logs into a registry or publishes.
