# Bringing projects into Tea

Tea contains the former standalone Ref, Radio, Maps, Marky, Letters to Steve, and Artbin projects. Each deployable app owns its routes, UI, storage, and runtime settings. Packages contain only shared or embeddable code. The [root README](../README.md) lists the workspaces and the [Maps app guide](../apps/maps/README.md) documents its current viewer and editor.

## Maps

Maps serves `maps.jackharrhy.dev`. Its Remix app is in `apps/maps/`; the hosted service, collaboration Worker, and local compiler are separate apps. The renderer, editor core, and protocol are packages. Maps owns its public routes, file formats, OAuth scope, browser storage, and Celld Worker identity. The former standalone repository and npm renderer package have been retired.

The viewer and editor use the same Tea renderer and map document model. Artbin uses the renderer for BSP previews. Current workspace checks cover the packages and app boundaries; `npm run test:hosted --workspace @tea/maps`, `npm run test:gpu --workspace @tea/maps`, and `npm run test:embed --workspace @tea/maps` cover browser integration when those paths change.

## Ref production transfer

On 2026-10-08, the Tea Ref image published from `main` and was deployed by digest to Newport. The source service was stopped for a final archive and a cold Celld-volume backup. The final archive matched the preliminary export. The Tea destination uses a fresh `ref_celld_tea` volume and the same Ref archive format; its restored board passed image readback. After the scoped Compose cutover, `ref.jackharrhy.dev` returned healthy and an authenticated production archive preserved one board, 49 items, 12 uploads, and 36 cached previews. Board content, layout, link metadata, and asset digests matched the frozen source. Item revisions were recreated by restore, so clients should reload. The original repository was retired from GitHub, and its local backup was removed after the Tea cutover was confirmed.

## Radio production transfer

On 2026-10-08, Tea published `tea-radio` from `main` with the Celld 0.6.2 fork. The original Mug Radio service was stopped, and its authoritative 4.4 GB SQLite database and WAL were copied to a new volume and compared byte for byte. Tea opened that copy with `wrangler.celld-cutover.jsonc`, retaining the original `radio` Worker and `radio-tracks` logical bucket. The original volume was never opened by the newer runtime.

The live source had one playing room and 52 tracks totaling 4,628,240,145 media bytes. Before source shutdown, and again against the private Tea stage and public Tea service, an authenticated audit captured the room directory, track order and metadata, volume, playback type and track ID, and each track's HEAD and suffix-range response. Those stable fields and every media probe matched. The public `radio.jackharrhy.dev` route and Mug container were healthy after cutover. `compare:instances` requires paused rooms, so this audit used the cold byte comparison plus read-only probes while preserving playback. The retired source volume and image backup were removed after cutover confirmation.

## Marky import

Marky was copied into `apps/marky` as `tea/marky` for `md.jackharrhy.dev`. The app now uses Remix 3.0.0, the Node Fetch server adapter, stable Remix components and assets, and a `ws` upgrade for its existing Yjs room protocol. Its Discord guild gate and Git-backed Markdown persistence remain app-owned. The source repository and its hostname had no running Newport container or content volume at import time, so Tea started with a separate empty volume. The public service uses the existing encrypted Discord credentials. The local source checkout was removed after the Tea deployment was confirmed, and the standalone GitHub repository was retired after Tea became public.

## Letters to Steve import

Letters to Steve was copied into `apps/letters-to-steve` from the standalone checkout. Tea pins Remix 3.0.0 and uses its stable component and asset APIs; the correspondence routes, SQLite migrations, attachment store, and editorial workflow remain app-owned. Its local Compose service has a separate volume and hostname.

On 2026-10-24, the Newport source was stopped and its SQLite database and uploads were copied to `/mnt/terrabud/docker-data/newport/steve_tea_data`. The source had four applied migrations, no letters, issues, or attachments, an empty upload directory, and a closed public-site setting. Tea's identical migrations opened the copy without changing those records. An isolated Tea container and the public service both rendered the closed site and Steve's protected inbox without browser errors. Newport now serves `ghcr.io/jackharrhy/tea-letters-to-steve:latest` on the existing hostname. The stopped source volume and standalone checkout remain available for rollback.

## Artbin import and production transfer

Artbin's web app, CLI, and two shared packages were copied from the standalone checkout into `apps/artbin`, `apps/artbin-cli`, `packages/artbin-core`, and `packages/artbin-ui`. The Tea app retains the Artbin name, routes, Fourm client ID, session cookie, production URL `https://artbin.jackharrhy.dev`, design system, and the published Maps renderer for its BSP previews.

On 2026-10-08, Tea published `ghcr.io/jackharrhy/tea-artbin@sha256:b32cd9c2450edeea787ee942edde87a4244d306204b0c4b0bcb5f4e8254a8c4d`. A private container served a copy of the production database and uploads, and rendered a copied BSP overview with walkability data and no renderer warnings. At 1440 pixels wide, its login screenshot was pixel identical to the original production page, and the full kitchen sink differed by 20 pixels across a 1440×3753 image.

The original Newport service was stopped for a final checksum-aware sync of its data, uploads, and temporary upload directories into `/mnt/terrabud/docker-data/newport/artbin_tea_data`. The two stopped SQLite databases had the same SHA-256 hash and passed `PRAGMA integrity_check`; the upload sync verified 89,469 files and transferred no changed upload bytes. Both copies had 70,141 file records, 1,100 folders, and 36 users. Only the Artbin Compose service changed image and mount destinations, from `/app/apps/web` to `/app/apps/artbin`. The public login and kitchen sink returned 200 without browser errors, the root redirected to login, and the OAuth start still used client `artbin` and `https://artbin.jackharrhy.dev/auth/4orm/callback`. The CLI whoami endpoint returned its expected unauthenticated 401 and the browser entry asset returned 200. The live database passed integrity check after startup with the same record counts. The retired source directories, image archive, and local checkout were removed after the Tea cutover was confirmed. Three open Artbin feature issues were transferred to Tea before the standalone GitHub repository was retired.
