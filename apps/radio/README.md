# @tea/radio

A multi-room synchronized audio player copied from the separate Radio repository for validation in Tea. Its pages and title bar use the `tea/radio` identity while preserving existing room and media APIs. Remix renders the application inside a Worker, and each
named room is a Celld/Cloudflare-compatible Durable Object with private SQLite state and
hibernatable WebSockets. Audio content lives in the `TRACKS` R2-compatible object binding.

## Local development

Install Tea's Node.js version and dependencies from the repository root, then start Wrangler's local development server:

```sh
npm ci
cp apps/radio/.dev.vars.example apps/radio/.dev.vars
npm run radio:dev
```

Use `npm run dev:celld` for a compatibility run on Celld, serving
<http://127.0.0.1:9876> with disposable local state under `apps/radio/.celld/dev/`. Use the Celld fork
selected in `Dockerfile` for this run and expose `CELLD_VAR_RADIO_PASSWORD` and
`CELLD_VAR_RADIO_SESSION_SECRET`. Production uses the ordinary Celld runtime and public SQLite
bucket configuration described below. The public lobby seeds `cozy` automatically, and
authenticated listeners can create additional persistent rooms.

Client assets are prebuilt into ignored `dist/client/` files because a Worker has no source
filesystem from which `remix/assets` can compile modules on demand.

Useful commands:

```sh
npm run build --workspace @tea/radio
npm run radio:dev
npm run dev:celld --workspace @tea/radio
npm run types:worker --workspace @tea/radio
npm run radio:check
```

## Deployment model and bake period

The Tea copy uses Worker name `tea-radio` and bucket name `tea-radio-tracks` so it can be validated separately. Tea's root `compose.yml` serves it at `radio.localhost` with an independent `radio-data` volume. The original Radio repository and its Newport deployment continue publishing and serving `ghcr.io/jackharrhy/radio` during the bake period. A production handoff will require a verified storage copy and an infrastructure change.

The application image includes Radio and copies `/usr/local/bin/celld` from
`ghcr.io/jackharrhy/celld:latest`, the [Celld fork](https://github.com/jackharrhy/celld) with native
SQLite object storage. The original repository currently publishes the `linux/amd64` image as
`ghcr.io/jackharrhy/radio:latest`, `:main`, and a commit tag. Tea does not publish this image yet.
The `dev.jackharrhy.radio.celld-image` image label records the bundled Celld binary.

One container prepares the configured backend, runs `celld diagnose`, deploys the Worker and
built assets, then execs Celld. The default `CELLD_BUCKET` is
`sqlite:///app/.celld/object-store/objects.sqlite3`, with replica files under
`CELLD_WATCH=/app/.celld/state`. Persist the entire `/app/.celld` directory and allow the image's
`node` user to write it. The SQLite object store is authoritative: it contains deployments,
Durable Object replication records, and the logical `TRACKS` R2 bucket, including audio bytes.
The room directory, queues, playback state, and track metadata remain in their existing Durable
Object SQLite schemas. Replica files can be rebuilt from the object store.

This backend runs one Radio runtime per local store. It has no host-loss failover or multi-host
shared-disk mode. The fork rejects a second runtime using the same store. The public Worker
listener is `0.0.0.0:44100`; its internal listener stays on loopback. Traefik terminates TLS and
should rate-limit `/join`. Radio owns its shared-password login and signed 30-day session.

Set `CELLD_VAR_RADIO_PASSWORD` and a random 32-character-or-longer
`CELLD_VAR_RADIO_SESSION_SECRET`. When enabling `CELLD_TRUST_FORWARDED_HEADERS=1`, configure
Traefik to replace forwarded host/protocol headers. Only the public listener should be exposed.
The application has no individual accounts or room-level authorization: every holder of the
shared password can see, create, and mutate every room. The upload limit remains **1 GiB**
(1,073,741,824 bytes) per track.

Azure remains available for baseline comparisons and migration. Set `CELLD_BUCKET=az://CONTAINER`
and `AZURE_STORAGE_USE_EMULATOR=true` for Azurite. `AZURITE_BLOB_STORAGE_URL` selects the emulator's
base URL, such as `http://azurite:10000`; startup creates the container with the public emulator
credentials. Set `AZURE_STORAGE_USE_EMULATOR=false` and provide the usual Celld Azure credentials
for a pre-provisioned Azure container. The application and its Worker bindings are identical for
both backends.

Changing `CELLD_BUCKET` does not migrate existing data. Before a backend cutover, stop writers,
keep a recoverable snapshot of the old backend, and use the fork's object-store migration tooling
to copy every object and attribute. Verify room IDs, directory entries, queue/playback state,
track keys, sizes, hashes, and ranged media responses against the source before routing traffic
to the new backend. Preserve the original backend until that comparison passes. For subsequent
SQLite backups, use a consistent SQLite backup or stop the runtime and preserve the database
with its WAL; copying a live main database file alone is insufficient. Never remove
`object-store/` when clearing the replica cache.

The default `wrangler.jsonc` uses the separate `tea-radio` Worker and `tea-radio-tracks` logical bucket during the bake period. A copy of the original Celld object store cannot expose its rooms through those new names: the room directory belongs to the original Worker identity, and its audio is under `radio-tracks`. On a **copied, isolated** Celld store, set `RADIO_CELLD_DEPLOY_CONFIG=wrangler.celld-cutover.jsonc` to run Tea's code with the original `radio` Worker and `radio-tracks` names. The normal startup script accepts only this explicit config or the default. Do not point the cutover config at the live original store while it is serving traffic.

To check that path with disposable source data, run the original Radio repository's `test:celld` with `--keep-state --output /tmp/radio-source-smoke.json`, then from Tea run:

```sh
npm run test:source-cutover --workspace @tea/radio -- /tmp/radio-source-smoke.json
```

This optional check requires Celld, SQLite's `sqlite3` CLI, and Playwright Chromium. It makes a consistent SQLite snapshot of the stopped source smoke store, starts Tea Radio with the cutover config and fresh credentials, and verifies the original room, track ID, queue title, volume, paused position, audio hash, and suffix range. Tea then renames the copied track and changes its volume, kills Celld, removes its replica cache, and verifies those edits and the audio from the copied authoritative store. It reads but does not change the source store. It does not prove a production transfer; repeat the same comparisons on a production snapshot before changing routing.

For a full read-only comparison of two running instances, set `RADIO_SOURCE_URL`, `RADIO_SOURCE_PASSWORD`, `RADIO_TEA_URL`, and `RADIO_TEA_PASSWORD` privately, then run `npm run compare:instances --workspace @tea/radio -- --output /safe/place/radio-comparison.json`. Use distinct origins and pause every room before the comparison; playing positions change with time and are rejected. Keep both datasets free of other writes until it finishes. The command compares the complete room directory, ordered track metadata, paused position, volume, and every track's streamed SHA-256, byte count, content type, and suffix range. It only joins rooms as a temporary listener. The optional report is created with private file permissions and fails if its path already exists. A match is evidence for the copied dataset at that moment; preserve the source backup and perform the separate routing cutover only after reviewing it. The command does not compare listener presence or edit history.

### Upgrading Celld 0.4 to 0.5

The fork now follows upstream Celld 0.5.1. Its alarm storage format changes when opening older
state. Before deploying the first 0.5 image, stop Radio and back up the entire persistent
`/app/.celld` mount, including the authoritative SQLite database and any WAL, and record the
current Radio image digest. Keep the runtime stopped while taking that backup. Qualify the
upgrade on a disposable copy first, then deploy through the ordinary infra update flow.

Do not point the old runtime at state opened by 0.5. To roll back, stop the new runtime, restore
the complete pre-upgrade backup, and use the recorded old image. Clearing replica files alone
does not undo the migration. The upgrade does not change Radio's room IDs, track keys, or 1 GiB
upload limit.

## Real Celld verification

Tea CI runs the production smoke with an 8 MiB payload using the fork selected by `Dockerfile` when Radio is affected.
To investigate runtime or storage changes locally:

```sh
CELLD_BIN=/absolute/path/to/celld npm run test:celld -- --output /tmp/radio-sqlite-smoke.json
CELLD_BIN=/absolute/path/to/new-celld npm run test:celld -- --upgrade-from-binary /absolute/path/to/old-celld --output /tmp/radio-upgrade-smoke.json
CELLD_BIN=/absolute/path/to/celld npm run test:celld -- --upload-bytes 1073741824 --output /tmp/radio-1gib-smoke.json
CELLD_BIN=/absolute/path/to/celld npm run test:celld -- --backend azurite --azurite-url http://127.0.0.1:10000 --allow-azure-suffix-limitation --output /tmp/radio-azurite-smoke.json
```

For a containerized 1 GiB check, put the disposable state on a disk-backed filesystem. Set `TMPDIR` to such a directory before running the smoke; a tmpfs-backed `/tmp` charges the SQLite object file as active shared memory inside the container and changes the memory test.

Install Playwright's Chromium with `npx playwright install chromium` if needed. The test builds
production assets, uses a temporary store and random authentication credentials, creates a room,
uploads a deterministic WAV through the real streaming API, checks browser decoding/playback,
and verifies the complete SHA-256, HEAD, and bounded/suffix byte ranges. It acknowledges queue,
volume, and paused-position changes over an authenticated WebSocket, kills Celld with SIGKILL,
removes its replica directory, restarts through
the production startup script, and verifies the directory, room state, and media again. The
payload defaults to 8 MiB; the explicit 1 GiB run checks the application limit. Failures exit
nonzero and retain the temporary state and runtime log. Use `--keep-state` to retain a successful
run's files. On Linux, the report also records the runtime's peak RSS. Azurite must already be running; each test creates its own uniquely named container.
The Azure adapter currently rejects suffix ranges. The explicit
`--allow-azure-suffix-limitation` flag records that HTTP failure and permits the remaining Azure
checks to run; the result is `passed_with_known_limitations`. SQLite always requires suffix
ranges to pass. These are runtime process-crash checks on the same host, not disk-loss or
host-loss tests.

The optional `--upgrade-from-binary` run writes and acknowledges room state and audio with the
old binary, kills it, discards the replica cache, then opens the authoritative SQLite store with
the new binary and checks the same state and exact media bytes. It then acknowledges a new queue
change and repeats the crash and cold restore with the new runtime. Both binary versions and
hashes are recorded.

For storage or resource-limit investigations, the optional full 1 GiB container smoke runs under
**one CPU and 1 GiB of memory**, with swap disabled. On a Linux Docker host with cgroup v2,
pull the image and run:

```sh
docker pull ghcr.io/jackharrhy/radio:latest
node scripts/test-celld.mjs --image ghcr.io/jackharrhy/radio:latest --upload-bytes 1073741824 --output /tmp/radio-container-smoke.json
```

The container test uses Docker's host network and a fresh temporary bind mount. It runs as the
invoking host UID/GID so the mount remains writable, inspects the
actual CPU/memory limits, and verifies the killed container's host PID has exited. It records
both Celld's peak RSS and the cgroup memory peak, and requires zero OOM kills. The
image's existing built application and bundled Celld binary are used throughout both starts.

## Room and storage ownership

- `worker.ts` owns only Worker startup and public request dispatch.
- `app/data/worker-radio-runtime.ts` owns Durable Object and object-storage adapters, uploads, and
  ranged media responses.
- `app/data/room-directory-cell.ts` owns the persistent public room directory.
- `app/data/radio-room-cell.ts` owns one room's SQLite state, WebSockets, queue, and playback.
- `app/data/radio-room-store.ts` owns the room's SQLite schema and persistence operations.
- `app/routes.ts` and `app/actions/` own the server-rendered page contract.
- `app/assets/` owns hydrated playback, clock synchronization, and browser audio.
- `__tests__/worker/` owns Worker, Durable Object, R2, alarm, and WebSocket integration tests.
- `dist/client/` is generated and must not be committed.

## Playback synchronization

Clients exchange paired four-timestamp probes with their room cell. The browser keeps a bounded
low-delay sample history, rejects network-delay outliers, and fits a robust offset-and-clock-skew
model. Shared server timestamps are converted to the Web Audio timeline with
`AudioContext.getOutputTimestamp()` when available, with an output-latency fallback otherwise.

The media element streams the track through separate volume and audible-gate gain stages. During
playback, a bounded ±800 ppm rate servo corrects small clock drift; errors of 750 ms or more are
re-anchored by seeking. The `−10ms` and `+10ms` controls persist a per-browser output-device
calibration for latency that the browser cannot measure, such as downstream Bluetooth buffering.

## Inspiration

The synchronization approach, and overall vibes, are derived from [freeman-jiang/beatsync](https://github.com/freeman-jiang/beatsync).
