# Node container checks

The deployed Node apps use prebuilt `platformatic/node-caged:26-slim` in both stages (Debian Trixie). Local development remains on the root `.nvmrc`. The runtime creates `node` explicitly at UID/GID 1000 because this base does not provide that account.

<!-- prettier-ignore -->
| Dockerfile under `apps/` | Runtime | Image / scope |
| --- | --- | --- |
| `cms` | Node + `remix/node-tsx`, built-in SQLite | `tea-cms`, Mug |
| `artbin` | Node + `remix/node-tsx`, better-sqlite3, sharp, Chromium | `tea-artbin`, Newport |
| `letters-to-steve` | `npm start` → Node + `remix/node-tsx`, built-in SQLite, sharp | `tea-letters-to-steve`, Newport |
| `marky` | `npm start` → Node + `remix/node-tsx`, filesystem/Git/WebSocket | `tea-marky`, Newport |
| `maps-service` | Node, built-in SQLite | `tea-maps-service`, Newport |
| `maps-compiler` | Node; external native executables are not bundled | `tea-maps-compiler`, Newport (including Gower instance) |
| `shell-mcp` | Node, locked shell runner | Not a deployed fleet image; unchanged |
| `maps` | Celld Worker; Node builds/deploys it | `tea-maps`; unchanged |
| `maps-collaboration` | Celld Worker; Node builds/deploys it | `tea-maps-collaboration`; unchanged |
| `ref` | Celld Worker; Node builds/deploys it | `tea-ref`; unchanged |
| `radio` | Celld Worker; Node builds/deploys it | `tea-radio`; unchanged |

These are all repository Dockerfiles. There are no standalone static, Bun or other non-Node Dockerfiles; the Worker runtimes above are not Node application processes. All published image names in the table use `ghcr.io/jackharrhy/` and retain their existing tags and publishing workflows.

## Native modules

The current better-sqlite3 13 package uses N-API, unlike older V8/NAN releases. Nevertheless, builders that install it remove its prebuilds and invoke npm's bundled node-gyp directly with `--nodedir=/usr/local --jobs=2`. This uses the compression-enabled headers/config shipped with the actual runtime, does not download stock Node headers, and ensures the rebuilt binding is loaded instead of a preferred prebuild. Sharp remains on its N-API binary. Keep the SQLite write/reopen and sharp encode/decode checks when updating either dependency. Do not assume a matching Node module ABI alone makes a V8/NAN addon safe.

Artbin's selected install also includes root dev tools: its renderer build needs the root `tsrs` executable. Workspace selection and production pruning otherwise remain intact.

## Reproduce

```sh
app=artbin # cms, letters-to-steve, marky, maps-service, maps-compiler
docker build -f "apps/$app/Dockerfile" -t tea-smoke .
node scripts/ci/node-image-smoke.mjs "$app" tea-smoke
# The same compiler image also serves Gower:
node scripts/ci/node-image-smoke.mjs maps-compiler tea-smoke gower
```

The smoke starts the real image command with no host mounts, ports or network, then checks Node 26, pointer compression, UID, loader startup, HTTP/auth boundaries and applicable migrated databases/native bindings. Disposable container layers are removed even on assertion failure. Compiler checks deliberately assert unconfigured health/compile responses: they do not call production toolchains, OAuth, game launches or remote services.

The repository-owned Node images workflow builds each of these six images serially on runtime/Docker dependency changes or manual dispatch. It never logs into a registry or publishes. The existing affected-workspace checks and publisher selectors, matrices, wrappers, migrations and tag rules remain separate and unchanged.
