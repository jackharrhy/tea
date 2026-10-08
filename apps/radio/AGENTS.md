# Radio Agent Guide

Radio is a multi-room synchronized audio player built with Remix 3 and Celld. Keep the
server-rendered route correct first, then layer the hydrated WebSocket and Web Audio behavior on
top. Each room is one named Durable Object/cell.

Read Tea's root AGENTS.md and this workspace's README before editing. Keep tests in adjacent `__tests__/` directories and Worker integration tests in `apps/radio/__tests__/worker/`.

## Commands

```sh
npm install
npm run dev
npm run build
npm run format
npm run lint
npm run check
npm run dev:celld
npm test
npm run test:celld
npm run typecheck
```

## Remix Version Alignment

- Follow Tea's `.agents/skills/remix/SKILL.md` when changing routes, middleware, assets, UI, or tests. Radio uses Tea's stable Remix 3 release.

## Beatsync Reference

The synchronization design was derived from the MIT-licensed [freeman-jiang/beatsync](https://github.com/freeman-jiang/beatsync) project.

Keep an inspection-only clone at `./.upstream/beatsync`. That directory is ignored by Git and must not become a runtime dependency or an accidental nested repository in commits. Preserve applicable upstream attribution when adapting code.

## Route And Runtime Ownership

- `app/routes.ts` is the URL contract.
- `worker.ts` owns Worker startup and public request dispatch.
- `app/data/worker-radio-runtime.ts` owns room-cell dispatch, upload storage, and ranged media
  responses.
- `app/actions/controller.tsx` owns top-level Remix HTTP responses.
- `app/router.ts` composes Remix middleware and maps the route contract.
- `app/middleware/render.tsx` owns request-scoped server rendering.
- `app/assets/` owns hydrated browser behavior and radio-specific client presentation.
- Keep clock estimation, audio-timeline conversion, and playback drift correction as separate pure
  models with synthetic skew, jitter, output-latency, and recovery tests.
- `app/data/radio-room-cell.ts` owns per-room SQLite state, WebSockets, and coordination.
- `app/data/radio-room-store.ts` owns the per-room SQLite schema and persistence operations.
- `app/data/room-directory-cell.ts` owns the persistent public room directory.
- `app/data/` owns the shared protocol, room identity, and timing policy.
- `app/middleware/access.ts` owns the shared-password session and access boundaries.
- `app/ui/` owns shared server UI and cross-route visual primitives.

Put code in the narrowest owner. Add `app/actions/<route-key>/controller.tsx` only when a nested route map needs its own actions or middleware. Do not create generic `app/lib/` or `app/components/` buckets.

## Local UI Kit

`app/ui/desktop/` is a deliberately small local UI kit, not a general design system.

- Keep theme tokens and reusable control/surface mixins there.
- Keep radio layout and radio-only selectors with the hydrated radio feature.
- Prefer native semantic elements plus Remix `mix` behavior over wrapper components that only pass props through.

## Visual Reference

- Use [spiritov/ds.css](https://github.com/spiritov/ds.css) and the Nintendo DS PictoChat UI as
  reference points when designing net-new components.
- Treat them as inspiration, not a package dependency or a pixel-perfect specification. Radio is a
  cleaner, higher-resolution interpretation that should still feel compact, tactile, and familiar.
- Translate PictoChat cues through the existing local tokens and primitives: pale neutral surfaces,
  restrained cyan accents, fine horizontal texture, crisp borders, small stepped corners, and clear
  pressed and focus states. Preserve accessibility and consistency with existing Radio components.

## State And Deployment Boundaries

- `.celld/dev/` contains ignored local cell and object state.
- `dist/client/` contains ignored, generated browser assets.
- Each room has isolated SQLite state and hibernatable WebSockets in one named cell.
- Uploaded audio lives in the `TRACKS` R2-compatible binding, not a filesystem.
- The public lobby lists rooms. A signed 30-day application session protects room pages,
  WebSockets, uploads, and room mutations. Listener names come from that trusted session rather
  than WebSocket messages.
- Authentication currently uses one shared application password. There are no individual users,
  room owners, or room-level permissions; every password holder can create and mutate every room.
- The approved production boundary is one Celld runtime behind Traefik TLS with rate limiting on the
  native `/join` action. Expose only Celld's public Worker listener; keep its internal
  peer/operator listener private.
- Production targets the `jackharrhy/celld` fork's explicitly single-node SQLite object
  store. The ordinary `sqlite:///absolute/path/objects.sqlite3` bucket configuration must work
  for deployment, diagnostics, and runtime startup; do not use `CELLD_INTERNAL_DEV_STORE` or
  `celld dev` as a production shortcut.
- The Radio image copies `/usr/local/bin/celld` from the verified fork image pinned by digest in
  `Dockerfile`. Keep that runtime independent of Radio's build; rehearse candidate images on
  isolated stores and never download a floating install script in Docker.
- Keep authoritative objects at `/app/.celld/object-store/objects.sqlite3` and replica/cache
  files at `/app/.celld/state`, under the persistent `/app/.celld` mount. A cache cleanup must
  never delete the object store. Back up the authoritative store consistently, including its WAL.
- Run one Radio runtime per local store. There is no host-loss failover or multi-host shared-disk
  mode. The Celld runtime guard must reject a second runtime or an offline migration.
- One Radio application container prepares the selected backend, diagnoses it, deploys the Worker,
  and then execs Celld. Azure/Azurite support remains for migration and comparison; it is not the
  default storage dependency. Do not add separate deployment-image or bootstrap services.
- Preserve all room and media APIs and the full 1 GiB upload limit. A backend change must preserve
  room IDs, track keys, queue/playback state, audio bytes, attributes, and range/HEAD behavior.
- Mug serves the Tea image from a copied Celld store. Its production image, volume, and routing are managed in the infrastructure repository; use `hosts/mug/radio/README.md` there for deployment and rollback.
- Keep `wrangler.jsonc` on Tea's isolated logical names. Mug uses `wrangler.celld-cutover.jsonc` and `RADIO_CELLD_DEPLOY_CONFIG` to retain the original logical Worker and audio bucket names on its copied production store.

## Verification

- Use Remix route/server tests for rendering and real Worker tests for HTTP and coordination behavior.
- Use component tests only for DOM-specific behavior.
- Add regression coverage for lifecycle, reconnect, synchronization, and persistence bugs.
- Run `npm run radio:check` from Tea's root; the original repository's CI also runs `npm run test:celld` against the fork
  image selected by `Dockerfile`. The smoke test uses only its own rooms and storage; it must
  preserve acknowledged queue changes and audio after SIGKILL with an empty replica directory.
- Use the optional full 1 GiB container smoke when investigating storage or resource-limit
  changes. Ordinary deployments use the published image after CI passes.
