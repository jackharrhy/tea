# Bringing projects into Harrhy

Harrhy contains the former standalone Ref, Radio, Worldview, Marky, Letters to Steve, Artbin, and Garden projects. Each deployable app owns its routes, UI, storage, and runtime settings. Packages contain only shared or embeddable code. The [root README](../README.md) lists the workspaces and the [Worldview app guide](../apps/worldview/README.md) documents its current viewer and editor.

## Auth source workspace

`apps/auth` imports the checked standalone Auth main at `0cdfc535` as an independent Node application. The browser login, consent, directory, access ledger, support flow, native action source, and synthetic HTTP/browser fixtures stay app-owned. Historical provider provisioning and acceptance scripts remain in the retained standalone repository; they are not startup migrations. The app's original MIT LICENSE remains with the source, and its two AGPL native action files keep their separate notices. This source integration does not switch the live Auth service, copy its databases or sealed keys, or change ZITADEL. A later scoped source slice will convert the Node HTTP routing to Remix 3 before a coordinated runtime cutover.

## Worldview

Worldview serves `worldview.harrhy.xyz`. Its Remix app is in `apps/worldview/`; the hosted service, collaboration Worker, and local compiler are separate apps. The renderer, editor core, and protocol are packages. Worldview owns its public routes, file formats, OAuth scope, browser storage, and Celld Worker identity. The former standalone repository and npm renderer package have been retired.

The viewer and editor use the same renderer and map document model. Artbin uses the renderer for BSP previews. Current workspace checks cover the packages and app boundaries; `npm run test:hosted --workspace @harrhy/worldview`, `npm run test:gpu --workspace @harrhy/worldview`, and `npm run test:embed --workspace @harrhy/worldview` cover browser integration when those paths change.

## Garden import and production rollover

On 2026-11-11, [Tea #78](https://github.com/jackharrhy/tea/pull/78) imported the personal website as the independent native Remix app in `apps/garden`, replacing Astro without adopting TeaCMS. Obsidian remains the authoring environment. Development reads the external Garden and Assets directories and reloads on note, browser-source, and static-file changes; production reads an explicitly published, read-only snapshot. Vault content, credentials, snapshots, and comparison captures are not committed to Tea.

The initial snapshot preserves all 124 deployed note hashes, including the published `Fonts.md` rather than its newer local version. Its manifest records 241 referenced media files instead of listing all 425 vault assets; no R2 objects were uploaded or deleted during the cutover. The original appearance, Obsidian Markdown extensions, component blocks, special layouts, feeds, tools, and URL conventions remain app-owned. Parser versions and the deployed CSS's rounded typography values are preserved for compatibility.

The staged container and public site passed status/text/link comparisons for all 124 notes. Thirty full-page captures across 1440, 768, and 390 pixels matched layout and text, with residual thumbnail/raster differences below 0.04%; the live mug and widget were controlled and GIFs compared at their first frame. The three public feeds retained their 10, 1, and 0 items. Both `jackharrhy.com` and `jackharrhy.dev` returned healthy, development routes and server-source URLs returned 404, and the public browser entry ran without errors.

[Infra #68](https://github.com/jackharrhy/infra/pull/68) changed only the existing Mug site's service image, internal port, and read-only snapshot mount, preserving domain labels, higher-priority routes, and the existing secret file. Production follows `ghcr.io/jackharrhy/tea-garden:latest`; its initial published digest was `sha256:80ac28118b4391b713a16ec2ce63b9d446f2c7b64f01b84d09a8e47368a50d09`. Watchtower remained operational. The original Astro image and pre-cutover configuration remain available for rollback; host paths and the separate content-publishing procedure live in the infrastructure repository's Garden guide.

The standalone [jackharrhy.com repository](https://github.com/jackharrhy/jackharrhy.com) is intentionally retained, not archived or deleted. [Its #53](https://github.com/jackharrhy/jackharrhy.com/pull/53) replaced the active application with a README pointer and local-data ignore rules. The `astro-before-tea-20261111` tag preserves the latest standalone source and its history. The local vault symlink, credentials, and ignored data were left untouched.

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

## Img source import

Img was copied from `jackharrhy/img` commit
`b1bfe860e59221b04bf96932bc7a42fe931f9cb1` into `apps/img` on 2026-11-10.
This is a source snapshot, not a Git history merge or repository retirement.
The original repository and local checkout remain intact. Native Rust/Rune
behavior, Cargo dependencies, fonts, and sample attribution are retained.
Integration tests moved into `__tests__/` with explicit Cargo targets. Harrhy
registers `@harrhy/img` for its workspace selector and supplies Linux build
prerequisites in CI. Build output and local screenshots are not imported.

Ref remains its existing image/link board. Shared image recipes, a WASM
processing API, and texture-bundle export are proposed follow-up work, not
features of this source import.
