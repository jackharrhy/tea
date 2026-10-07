# Bringing projects into Tea

Ref and Radio are copied into Tea as `@tea/ref` and `@tea/radio`. Their original repositories and deployments continue running during validation. Maps is Worldview's Tea identity. Its renderer, editor primitives, protocol, collaboration Worker, local compiler helper, Remix viewer, editor, project maps, resources, and access pages, and a hosted-service bake copy live in Tea. The editor UI and hosted UI integration are still in progress.

## Shared runtime boundary

Ref and Radio are Remix 3 Workers with prebuilt browser assets, SQLite Durable Objects, WebSockets, R2-compatible object bindings, and Celld containers. Worldview's collaboration service also uses a Worker, Durable Objects, and Celld. Each imported app owns its own Worker entrypoint, Wrangler config, bindings, container, checks, and persistent data. Tea's local Compose services use distinct volumes and development credentials.

The Tea Maps hosted service also reads `TEA_MAPS_*` compiler, public-origin, and token-introspection settings rather than the original `WORLDVIEW_*` settings. The Tea local compiler likewise uses `TEA_MAPS_*` game, tool, launch, listener, and limit settings; its default browser origins include only Tea Maps. The Tea Workers use new names and bucket names while they bake. Do not point them at an original project's `.wrangler/`, `.celld/`, R2 bucket, or production host. A cutover needs a recoverable source backup, a verified copy into the destination, checks of IDs and media bytes, and then a separate infrastructure update. Ref's archive commands support its board-level transfer. Radio's real Celld smoke verifies acknowledged state and media after a crash; an actual production transfer needs the Celld object-store migration and comparison described in its README.

When affected, CI checks Ref's browser flow on Wrangler and on the Celld binary selected by its Dockerfile. The Celld smoke kills the runtime, clears the replica cache, and reopens the copied board from the separate authoritative SQLite store. Radio's Celld smoke performs the same cold restore for room state and audio bytes. These checks use disposable stores; they do not prove a production data transfer.

## Cloudflare configuration

Cloudflare's new [`cf` CLI](https://developers.cloudflare.com/cf/) uses `cloudflare.config.ts` and is currently in beta. [Cloudflare's migration guide](https://developers.cloudflare.com/cf/wrangler/migrate/) says to convert Wrangler projects explicitly; its Durable Object lifecycle declaration differs from Wrangler migrations. [Celld currently reads only `wrangler.jsonc` or `wrangler.json`](https://celld.dev/docs/cloudflare-compat/#wrangler-configuration), so Ref, Radio, and the Maps collaboration Worker retain Wrangler-compatible configs for their shared runtime. Do not run `cf init`, `cf dev`, or `cf deploy` in those workspaces without an explicit dual-config migration that passes both Cloudflare and Celld checks. The Cloudflare-only CMS edge and Maps UI apps use `cf` and `cloudflare.config.ts` with the Cloudflare Vite plugin.

## Maps slices

Worldview is a monorepo, rather than one app. Tea's viewer opens generated example maps, local BSP and accompanying asset files, a browser-selected game folder, or a remote BSP URL with game asset overrides. Folder selection preserves game-relative asset paths, offers each BSP, and reads adjacent Worldview camera and walkability sidecars. Its first editor route uses the copied map core and WebGPU renderer for four viewports, session-backed brush creation, selection, duplication, movement, rotation, scaling, deletion, and undo/redo, `.map` import, guarded file saving where browser file handles are available, and download. It reads existing Worldview project manifests to list and switch local maps and loads their FGD, DEF, and ENT entity definitions, WAD2/WAD3 materials, Quake II WAL textures, PNG/JPEG/TGA replacements, and GoldSrc sprite roots. Project build profiles now choose preview or final quality for local BSP downloads through the machine-local compiler helper; supported BSP results can be inspected in the perspective pane, and Quake II/Gower builds send the used textures and palette from ordered game roots. A successful build can be exported with referenced project assets and optional map source; the same captured assets feed its compiled preview. The browser remembers each project’s logical build profile to local compiler capability binding by directory handle and falls back when a capability disappears. Project-scoped export settings now support a chosen folder, source inclusion, and automatic export after build; build bundles now include referenced Quake, GoldSrc, and Quake II model companions found in project resources. The viewer can list hosted projects and open successful BSP build artifacts through a same-origin Worker pass through. The Maps Worker forwards ticketed `/sync/maps/:mapId/*` HTTP and WebSocket requests to the collaboration Worker. Owners and editors can send semantic brush edits and personalized undo and redo over the live room; the browser persists an operation outbox and detaches expired or conflicting work into reopenable local copies that retain their source anchors. Tea lists those local copies on its Projects page and opens their latest local recovery revision in the editor without changing the hosted map. The editor shows live participants, selections, pointers, and compatible previews. Hosted source replacement now uses the service’s version and hash preconditions, keeps browser drafts through conflicts, and lets the live room reconnect to the replacement. Tea's viewer exposes map diagnostics, camera controls, overview export, walkability sidecars, and audio. Tea's development viewer now discovers local BSP fixtures from an ignored directory and serves their game files only during development; sidecar labels, aliases, cameras, and walkability graphs work with fixture links. Tea now reads Worldview Steam corpus manifests, selects a bounded set of playable BSPs, serves extracted game assets in development, and can extract and check owned game installs with Tea workspace commands. Some editor controls and collaboration UI still need to move into Remix. The embedded engine and editor primitives are intentionally reusable packages; the compiler, collaboration Worker, and hosted-project service are separate runtimes.

The Maps viewer now opens Worldview camera and fixture links and can copy the current view URL. The editor now keeps bounded local source versions and protected checkpoints; recovery restores open as detached copies so the original disk file is never replaced by a version choice.

The editor's Recent projects menu now renders as a Remix client entry while retaining the editor's folder permission and unsaved-work handling. The viewer source controls and hosted project pages also use Remix client entries.

The local project map chooser now renders and filters rows as a Remix client entry while the editor retains filesystem access and guarded map switching.

The hosted share link and live participant list now render as a Remix client entry. The editor keeps room membership, operations, and viewport overlays.

The editor's hosted Project access panel now renders as a Remix client entry and uses the same member service calls as the dedicated Access page. The editor only publishes the selected project ID to this panel.

The editor's Recovery versions dialog now renders local versions and hosted checkpoints through a Remix client entry. Protect and Unprotect operate on local versions; restoring a copy still goes through the editor's guarded map replacement flow.

The editor's Project sync dialog now renders hosted map mappings and source comparisons through a Remix client entry. Link, pull, and push still use the existing checked source and file operations.

The hosted source dialog now renders through a Remix client entry. The browser draft survives closing and reopening; replacing source still uses the service's version and hash checks and reconnects the live room.

The editor's hosted Project resources panel now renders through a Remix client entry. It keeps owner-only upload, Artbin import, and removal actions, and tells the open editor when mounts change.

The hosted picker's Recovery copies control now renders through a Remix client entry. It lists detached collaboration drafts stored in this browser and hands the selected copy to the editor's guarded open flow.

The hosted project and map picker controls now render through a Remix client entry. They load authorized projects, create maps, and pass open and compare actions to the editor while publishing the selected project to the access and resource panels.

The hosted build history now renders through a Remix client entry. It displays compiler availability, build results, downloads, and preview actions while the editor keeps build orchestration and preview loading.

The export settings controls now render through a Remix client entry. The editor retains project-scoped persistence, build packaging, folder selection, permission checks, and file writes.

The perspective FOV control now renders through a Remix client entry. Its browser-local default still applies before the editor's renderer starts, and camera changes update the control.

The References panel now renders through a Remix client entry. It loads, snapshots, offsets, hides, and removes read-only scenes while the editor retains the scene list for renderer recreation.

The Layers panel now renders through a Remix client entry. Layer creation, ordering, flags, and membership still use the editor session's source and undo path.

The read-only local and hosted source comparison now renders through a Remix client entry, including the first differing line and both source snapshots.

The editor material browser now renders and filters texture thumbnails through a Remix client entry. Its session actions still use the editor's existing selection and source guards.

The editor issue browser now renders findings and filters through a Remix client entry. Select, Reveal, and Fix still call the editor session and preserve its edit guards.

The editor's local view filters and entity link visibility controls now render through a Remix client entry. Brush and class visibility stays in the editor session, and the selected link mode is applied to new renderers.

The editor Performance button and diagnostics panel now render through Remix client entries. The existing frame and CPU timing collector publishes bounded samples to the panel while it is open.

The Tea editor now exposes exact shear and mirror transforms, Worldview view filters, and entity link visibility modes alongside the copied map issue diagnostics, type filters, local finding visibility, object reveal, and undoable repairs. It can create, rename, activate, reorder, hide, lock, isolate, and remove TrenchBroom-compatible layers, and move objects between them. It can create, rename, open, close, link duplicate, unlink, and ungroup TrenchBroom-compatible object groups. Group metadata survives source saving and hosted collaboration operations, and opening a group locks viewport interaction with objects outside it.

The entity inspector now exposes linked-group property protection. While editing an open linked copy, users can keep an existing or newly added property independent of its siblings.

Viewport picking now follows Worldview's closed-group and brush-entity selection rules, including opening a group on activation and selecting matching faces across a multi-brush selection in Face mode.

The four-viewport editor also exposes Worldview's clip, perspective hull, and face sweep tools. Clip previews back, split, and front results for selected brushes; hull creation previews a brush from placed face points. Sweep previews one or more selected faces through a configurable path and destination cap. All three commit through the session history and hosted semantic operation path.

Selection brushes now expose touching, enclosed, and XY/XZ/YZ projected queries in Tea. Each query consumes selected structural brushes, selects the matching objects, and can be undone as one edit.

Vertex and edge tools now expose the copied renderer's component handles in Tea. Drag, snap, insertion, keyboard nudge, and hull-safe deletion use the copied session candidates and the editor's normal history and hosted operation path.

Draw shape now uses Worldview's simple-shape generator for cuboids, stairs, arches, cylinders, cones, and both sphere types. Its bounding-box gesture previews the generated brush set, then commits that set as one creation transaction.

Rotate, scale, and shear now have viewport manipulators and a shared movable pivot. Exact toolbar transforms can use that pivot, and the renderer gesture candidates follow the session history and hosted operation path.

The Maps editor can load or snapshot read-only reference maps, edit project-defined entity properties with typed controls, adjust its perspective FOV, switch to a perspective-only view, resize its panes, and restore per-map camera and layout state from browser storage.

Opening a local folder project now shows a searchable map chooser before editing. It marks the last opened map when that history is available and asks about unsaved work before replacing the current map.

Local Maps saving now uses Worldview's source-preserving save plan. A blocked patch cannot overwrite the opened file or silently become a normal download; Export normalized creates a separate copy. Recovery snapshots retain the semantic document and source anchors.

The editor also has Worldview's opt-in performance sampling: bounded browser frame cadence and renderer CPU submission timing, with a 30-second JSON capture.

Its material browser now exposes loaded project and development textures as searchable thumbnails, with source and usage filters, selection commands, and scoped replacement through the editor session.

The selected-face UV editor now previews offset, rotation, and scale drags against the map renderer and commits them through the same session and hosted operation path. It supports a movable pivot, framing, pan and zoom, and adjustable snap grids.

The Tea editor now exposes WebMCP site tools for live document inspection, bounded object, issue, and material lists, and source slices in browsers that support `document.modelContext`. Tools frame the view and choose a viewport tool. Authoring tools select objects and faces, create boxes and point entities, translate, rotate, scale, shear, duplicate, or delete selections, edit materials and entity properties, and use local or personalized hosted history with document revision guards. Document tools can open a map from an authorized local project folder or replace the current source as a detached copy, with explicit confirmation for discarded work or replacement.

The hosted map picker can compare its selected hosted source with the current local editor source in a read-only dialog. This standalone comparison does not link maps or transfer source.

The project sync dialog can pair a local folder project's maps with a Tea hosted project, inspect source and baseline status, and explicitly pull to disk or push to the hosted service. It validates game and face syntax, checks both copies again before a write, and keeps the baseline in browser storage. Opening an original Worldview project with a link to its old origin requires changing the link before syncing with Tea.

Hosted Maps editing now exposes the room share link and participant presence details in Tea's editor, alongside its existing remote selection, pointer, and preview overlays.

The Tea editor can now create hosted projects and maps through the copied service API. A new map may start empty or import a checked local `.map` source, and the created map opens in the Tea editor.

The Remix `/projects` page lists hosted projects and recent local folders, and `/projects/:projectId` lists hosted maps with links to editing and built-map viewing. A separate New map route lets owners and editors create hosted maps. The project also has Resources and Access routes. Owners can upload resources, import copies from configured Artbin, remove mounts, and manage member roles; members can download mounts. The hosted project page can open a local folder after checking its game and hosted link. Local project links reopen the recent folder in the editor when browser permission persists; the editor's Recent projects menu can request folder permission again when needed. These pages use the existing same-origin service API and keep the original editor controls available during validation.

The Maps hosted browser check runs disposable OAuth, Artbin, and compiler fixtures with the real Tea Maps Worker, service, and collaboration Worker. It verifies unauthenticated access control, OAuth callback, project and map creation, owner and viewer roles, resource upload and download, Artbin import, editor launch, hosted build queueing, and BSP artifact download through the live same-origin proxy. The compiler fixture checks integration rather than the native toolchain, which has its own workspace checks. This covers the local integration path; it does not use an original Worldview account or deployment.

The Remix `/new-map` page now carries Worldview's standalone setup flow into Tea. It chooses a local map's name, game, and compatible face format before opening the editor, including Quake II's classic faces. The editor keeps its unsaved-change prompt when a new launch replaces a recovered draft.

Hosted project resources now feed the open editor’s materials, entity definitions, and sprites, matching the local project resource path. Resource loads are cancelled when the map changes. Hosted project resources can now be listed, downloaded, uploaded, and removed in the Tea editor. Project owners can also search Artbin and import a checked asset through the copied hosted service when that integration is configured. Uploads use the copied service's contained path rules and limits; project owner access remains enforced by the service.

Project owners can also manage signed-in users' editor and viewer roles in Tea. The copied service still enforces ownership and membership for access changes and room tickets.

The editor's Build BSP action now calls the hosted build API for hosted maps, checks the reviewed map version, polls the server job, and exposes BSP history and downloads. The local compiler path remains for local maps and projects.

<!-- prettier-ignore -->
| Source boundary | Tea boundary | Validation |
| --- | --- | --- |
| `packages/worldview` | `packages/maps-renderer` | Copied public renderer and core parser; package and viewer checks pass |
| `packages/worldview-editor` and `packages/worldview-protocol` | `packages/maps-editor` and `packages/maps-protocol` | Copied app-independent packages; 235 editor and 4 protocol tests pass |
| `apps/viewer` and `apps/editor` | `apps/maps` | Remix viewer and four-viewport editor slices serve; hosted brush edits and presence use the room protocol, while advanced tools remain |
| `apps/worldview-service` | `apps/maps-service` | All public routes use Remix controllers and Web Responses; Node hosts the listener and local storage |
| `apps/compiler-service` | `apps/maps-compiler` | Copied the bounded native pipeline behind Remix routes; local HTTP and compiler tests pass |
| `apps/collaboration-service` | `apps/maps-collaboration` | Copied the SQLite map cell and WebSocket protocol behind Remix routes; Worker tests pass |

Worldview's MIT attribution and third-party notices must move with any adapted source. Never copy local game assets or commercial data. Keep the original npm packages and public deployment in place until Tea's replacements pass their consumer and browser checks and an explicit publication plan is ready.

Tea Maps now exposes hosted map checkpoints through the service and editor. The editor lists recorded versions and lets editors create them after live edits sync; a checkpoint can be reopened as an independent local source copy without changing the hosted map.

Hosted BSP views and editor previews now resolve mounted WADs, palettes, game-tree textures, sprites, and sounds through the Tea project resource API. For GoldSrc builds, Tea reads the BSP sky name and selects a complete six-face set from the hosted project mounts when available.
