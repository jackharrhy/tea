/**
 * Authoritative server model, the server is the
 * single source of truth for all game state.
 *
 * 1. INPUT PROCESSING
 *    Clients send input commands. The server validates each one (see
 *    input-validation.ts), rejects malformed/replayed messages, and
 *    queues up to 128 deep per connection. Each tick processes at most
 *    MAX_INPUTS_PER_TICK so a flooding client cannot speed-hack.
 *    Each input has a sequence number for acknowledgment.
 *
 * 2. AUTHORITATIVE PHYSICS
 *    The server runs the physics tick at (TICK_RATE)hz, but each input is
 *    applied at the client-supplied cmd.msec (clamped to MAX_INPUT_MSEC by
 *    the validator). This keeps motion-per-input frame-rate-independent:
 *    a 144Hz client sends ~144 short inputs/sec, a 60Hz client sends ~60
 *    longer inputs/sec, and both produce the same total motion per second.
 *    The clamp bounds speed-hacking to ~2x normal per input.
 *
 * 3. STATE BROADCAST
 *    Every tick, the server broadcasts GAME_STATE to all clients.
 *    This includes position, velocity, and last-acknowledged input seq.
 *    Clients use this to reconcile their predictions.
 *
 * 4. ENTITY SYNCHRONIZATION
 *    - SNAPSHOT: Full world state sent on connect (structural + SoA data)
 *    - OBSERVER: Delta updates for entity add/remove (purely structural)
 *    - SOA:      Field-data deltas following an OBSERVER add. The bitecs
 *                observer stream doesn't carry field values, so we follow
 *                up with a SoA payload covering entities marked dirty via
 *                markEntityDirty().
 *    - GAME_STATE: Authoritative positions (player movement, every tick)
 *    - YOUR_EID: Sent on connect with [PROTOCOL_VERSION, eid, bounds.x,
 *      bounds.y, bounds.w, bounds.h]; clients verify the version, attach
 *      bounds to their world, and disconnect on version mismatch.
 *
 * 5. PAINT (admin only)
 *    Admins can place/erase tiles via PAINT messages. Each paint is
 *    validated (paint-validation.ts), gated on isAdmin, capped to
 *    MAX_PAINTS_PER_TICK per connection per tick, persisted to SQLite
 *    via paint.ts. Erase + replace produce RemoveEntity/AddEntity
 *    observer events; new tile entities are also marked dirty so the next
 *    SoA broadcast carries their Position/Tile field values.
 */

import type { Database } from "bun:sqlite";
import { Elysia, t } from "elysia";
import { staticPlugin } from "@elysiajs/static";
import { router } from "../app/router";
import {
  MESSAGE_TYPES,
  PROTOCOL_VERSION,
  networkedComponents,
} from "@tea/burger-core";
import { createObserverSerializer } from "bitecs/serialization";
import { reconcileTileSolidity, type World } from "./world";
import type { AuthConfig } from "./auth/config";
import { authRoutes } from "./auth/routes";
import { parseSessionCookie, getSession } from "./auth/sessions";
import { getUserById } from "./auth/users";
import {
  OBSERVER_BUFFER_SIZE,
  getPlayerConnections,
  getObserverSerializers,
  getSnapshotPayload,
  registerConnection,
  unregisterConnection,
  handleIncomingMessage,
  tagMessage,
  broadcastCatalogUpdated,
  broadcastZonesUpdated,
  sendMyZonesTo,
  markEntityDirty,
} from "./network.server";
import { validateCatalog } from "./catalog-validation";
import { saveCatalog } from "./catalog-save";
import { renameCatalogId } from "./catalog-rename";
import { validateSpawn } from "./spawn-validation";
import { resetAiPlayers, getAiEntities } from "./ai";
import { getPalette, setPalette, validatePaletteIds } from "./palette";
import {
  createZone,
  renameZone,
  deleteZone,
  mutateZoneCells,
  setZoneMembers,
} from "./zone-mutations";

export type AppDeps = {
  world: World;
  db: Database;
  authConfig: AuthConfig;
  onPlayerJoin: (displayName: string) => number;
  onPlayerLeave: (eid: number) => void;
};

export const buildApp = (deps: AppDeps) => {
  const { world, db, authConfig, onPlayerJoin, onPlayerLeave } = deps;
  const { Networked } = world.components;

  const requireAdmin = (
    cookieHeader: string | null,
  ): { ok: true; userId: string } | { ok: false } => {
    const sessionId = parseSessionCookie(cookieHeader);
    if (!sessionId) return { ok: false };
    const session = getSession(db, sessionId);
    if (!session) return { ok: false };
    const user = getUserById(db, session.userId);
    if (!user || !user.isAdmin) return { ok: false };
    return { ok: true, userId: user.id };
  };

  const requireUser = (
    cookieHeader: string | null,
  ): { ok: true; userId: string } | { ok: false } => {
    const sessionId = parseSessionCookie(cookieHeader);
    if (!sessionId) return { ok: false };
    const session = getSession(db, sessionId);
    if (!session) return { ok: false };
    const user = getUserById(db, session.userId);
    if (!user) return { ok: false };
    return { ok: true, userId: user.id };
  };

  const zonesList = () => {
    return [...world.zones.values()].map((z) => ({
      id: z.id,
      name: z.name,
      member_user_ids: [...z.members],
      cell_count: z.cells.size,
    }));
  };

  const zonesState = { zones: world.zones, cellToZone: world.cellToZone };

  // Compute the union of paintable cells across every zone a user belongs
  // to. Returned as a flat list of [x, y] pairs suitable for the MY_ZONES
  // payload.
  const paintableCellsFor = (userId: string): [number, number][] => {
    const cells: [number, number][] = [];
    for (const z of world.zones.values()) {
      if (!z.members.has(userId)) continue;
      for (const key of z.cells) {
        const [x, y] = key.split(",").map(Number);
        cells.push([x as number, y as number]);
      }
    }
    return cells;
  };

  // Recomputes and pushes MY_ZONES for each affected non-admin user.
  // Admin users are no-ops inside sendMyZonesTo, so passing admin ids is
  // safe (cheap).
  const sendMyZonesToAffected = (userIds: string[]): void => {
    for (const userId of userIds) {
      sendMyZonesTo(userId, paintableCellsFor(userId));
    }
  };

  return new Elysia()
    .use(
      staticPlugin({
        assets: process.env.WEB_ROOT ?? "./public",
        prefix: "/",
      }),
    )
    .use(authRoutes({ db, config: authConfig }))
    .get("/", ({ request }) => router.fetch(request))
    .get("/atlas", ({ request }) => router.fetch(request))
    .get("/login", ({ set }) => {
      set.status = 302;
      set.headers.location = "/auth/login";
      return "";
    })
    .get("/api/atlas", () => ({
      width: world.atlasInfo.width,
      height: world.atlasInfo.height,
      // url carries the cache-busting version so clients don't have to
      // know how to construct it. URL changes whenever atlas.png changes.
      url: `/assets/atlas.png?v=${world.atlasInfo.version}`,
      typeIdToAtlasSrc: world.typeIdToAtlasSrc,
    }))
    .get("/api/catalog", () =>
      db
        .query(
          "SELECT id, type, src_x, src_y, label FROM tile_catalog ORDER BY id",
        )
        .all(),
    )
    .post(
      "/api/catalog/save",
      async ({ body, headers, set }) => {
        const auth = requireAdmin(headers.cookie ?? null);
        if (!auth.ok) {
          set.status = 403;
          return {
            ok: false,
            errors: [{ field: "auth", message: "admin required" }],
          };
        }

        const validation = validateCatalog(body, {
          atlasW: world.atlasInfo.width,
          atlasH: world.atlasInfo.height,
        });
        if (!validation.ok) {
          set.status = 400;
          return { ok: false, errors: validation.errors };
        }

        const result = await saveCatalog({
          db,
          entries: validation.entries,
          broadcast: (catalog) => {
            // Update in-memory catalog (world.catalog: Map<number, CatalogEntry>).
            world.catalog.clear();
            world.catalogIds.clear();
            for (const e of catalog) {
              world.catalog.set(e.id, e);
              world.catalogIds.add(e.id);
              world.typeIdToAtlasSrc[e.id] = [e.src_x, e.src_y];
            }
            // Catch up any tile entity whose catalog row's type just flipped
            // (wall → floor or vice versa). The bitecs observer stream picks
            // up the Solid add/remove and broadcasts to all clients.
            reconcileTileSolidity(world);
            broadcastCatalogUpdated(catalog);
          },
        });
        if (!result.ok) {
          set.status = 409;
          return { ok: false, errors: result.errors };
        }
        return { ok: true };
      },
      {
        body: t.Array(
          t.Object({
            id: t.Number(),
            type: t.Union([
              t.Literal("floor"),
              t.Literal("wall"),
              t.Literal("counter"),
            ]),
            src_x: t.Number(),
            src_y: t.Number(),
            label: t.String(),
          }),
        ),
      },
    )
    .post(
      "/api/catalog/rename",
      ({ body, headers, set }) => {
        const auth = requireAdmin(headers.cookie ?? null);
        if (!auth.ok) {
          set.status = 403;
          return {
            ok: false,
            errors: [{ field: "auth", message: "admin required" }],
          };
        }

        const result = renameCatalogId(db, { from: body.from, to: body.to });
        if (!result.ok) {
          set.status = 409;
          return { ok: false, errors: result.errors };
        }

        // Cascade rename to in-memory state.
        const cat = world.catalog.get(body.from);
        if (cat) {
          world.catalog.delete(body.from);
          world.catalogIds.delete(body.from);
          world.catalog.set(body.to, { ...cat, id: body.to });
          world.catalogIds.add(body.to);
          delete world.typeIdToAtlasSrc[body.from];
          world.typeIdToAtlasSrc[body.to] = [cat.src_x, cat.src_y];
        }

        // Update existing tile entities in the ECS so their Tile.type matches.
        const { Tile } = world.components;
        for (const [, eid] of world.tilesAtPosition) {
          if (Tile.type[eid] === body.from) {
            Tile.type[eid] = body.to;
            markEntityDirty(eid);
          }
        }

        // Broadcast the new full catalog.
        const newCatalog = Array.from(world.catalog.values());
        broadcastCatalogUpdated(newCatalog);

        return { ok: true };
      },
      {
        body: t.Object({
          from: t.Number(),
          to: t.Number(),
        }),
      },
    )
    .get("/api/settings/spawn", () => world.spawnZone)
    .post(
      "/api/settings/spawn",
      ({ body, headers, set }) => {
        const auth = requireAdmin(headers.cookie ?? null);
        if (!auth.ok) {
          set.status = 403;
          return {
            ok: false,
            errors: [{ field: "auth", message: "admin required" }],
          };
        }

        const validation = validateSpawn(body, world.bounds);
        if (!validation.ok) {
          set.status = 400;
          return { ok: false, errors: validation.errors };
        }
        const { zone } = validation;

        // Persist to settings table and mutate the live world atomically.
        const tx = db.transaction(() => {
          const upsert = db.prepare(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
          );
          upsert.run("spawn_x", String(zone.x));
          upsert.run("spawn_y", String(zone.y));
          upsert.run("spawn_w", String(zone.w));
          upsert.run("spawn_h", String(zone.h));
        });
        tx();

        world.spawnZone = zone;

        return { ok: true, zone };
      },
      {
        body: t.Object({
          x: t.Number(),
          y: t.Number(),
          w: t.Number(),
          h: t.Number(),
        }),
      },
    )
    .get("/api/bots", () => ({ count: getAiEntities().length }))
    .post("/api/bots/reset", ({ headers, set }) => {
      const auth = requireAdmin(headers.cookie ?? null);
      if (!auth.ok) {
        set.status = 403;
        return {
          ok: false,
          errors: [{ field: "auth", message: "admin required" }],
        };
      }
      const count = resetAiPlayers(world);
      return { ok: true, count };
    })
    .get("/api/palette", ({ headers, set }) => {
      const auth = requireUser(headers.cookie ?? null);
      if (!auth.ok) {
        set.status = 403;
        return {
          ok: false,
          errors: [{ field: "auth", message: "authentication required" }],
        };
      }
      return { ok: true, ids: getPalette(db, auth.userId) };
    })
    .put(
      "/api/palette",
      ({ body, headers, set }) => {
        const auth = requireUser(headers.cookie ?? null);
        if (!auth.ok) {
          set.status = 403;
          return {
            ok: false,
            errors: [{ field: "auth", message: "authentication required" }],
          };
        }
        const validation = validatePaletteIds(body.ids);
        if (!validation.ok) {
          set.status = 400;
          return { ok: false, errors: validation.errors };
        }
        // Reject ids not in the catalog.
        for (const id of validation.ids) {
          if (!world.catalogIds.has(id)) {
            set.status = 400;
            return {
              ok: false,
              errors: [
                { field: "ids", message: `tile id ${id} not in catalog` },
              ],
            };
          }
        }
        setPalette(db, auth.userId, validation.ids);
        return { ok: true, ids: validation.ids };
      },
      {
        body: t.Object({ ids: t.Array(t.Number()) }),
      },
    )
    .get("/api/zones", ({ headers, set }) => {
      const auth = requireAdmin(headers.cookie ?? null);
      if (!auth.ok) {
        set.status = 403;
        return { ok: false };
      }
      return { zones: zonesList() };
    })
    .post("/api/zones", ({ body, headers, set }) => {
      const auth = requireAdmin(headers.cookie ?? null);
      if (!auth.ok) {
        set.status = 403;
        return { ok: false };
      }
      const name = (body as { name?: unknown })?.name;
      const r = createZone(db, zonesState, name);
      if (!r.ok) {
        set.status = r.error === "name_taken" ? 409 : 400;
        return { ok: false, error: r.error };
      }
      broadcastZonesUpdated();
      return { id: r.id, name: r.name };
    })
    .patch("/api/zones/:id", ({ params, body, headers, set }) => {
      const auth = requireAdmin(headers.cookie ?? null);
      if (!auth.ok) {
        set.status = 403;
        return { ok: false };
      }
      const id = Number(params.id);
      const name = (body as { name?: unknown })?.name;
      const r = renameZone(db, zonesState, id, name);
      if (!r.ok) {
        set.status =
          r.error === "name_taken" ? 409 : r.error === "not_found" ? 404 : 400;
        return { ok: false, error: r.error };
      }
      broadcastZonesUpdated();
      return { id: r.id, name: r.name };
    })
    .delete("/api/zones/:id", ({ params, headers, set }) => {
      const auth = requireAdmin(headers.cookie ?? null);
      if (!auth.ok) {
        set.status = 403;
        return { ok: false };
      }
      const id = Number(params.id);
      const r = deleteZone(db, zonesState, id);
      if (!r.ok) {
        set.status = 404;
        return { ok: false, error: r.error };
      }
      broadcastZonesUpdated();
      sendMyZonesToAffected(r.affectedUserIds);
      return { ok: true };
    })
    .put("/api/zones/:id/cells", ({ params, body, headers, set }) => {
      const auth = requireAdmin(headers.cookie ?? null);
      if (!auth.ok) {
        set.status = 403;
        return { ok: false };
      }
      const id = Number(params.id);
      const b = body as { add?: unknown; remove?: unknown };
      const r = mutateZoneCells(
        db,
        zonesState,
        id,
        { add: b?.add, remove: b?.remove },
        world.bounds,
      );
      if (!r.ok) {
        set.status = 404;
        return { ok: false, error: r.error };
      }
      broadcastZonesUpdated();
      sendMyZonesToAffected(r.affectedUserIds);
      return {
        added: r.added,
        removed: r.removed,
        dropped: r.dropped,
      };
    })
    .put("/api/zones/:id/members", ({ params, body, headers, set }) => {
      const auth = requireAdmin(headers.cookie ?? null);
      if (!auth.ok) {
        set.status = 403;
        return { ok: false };
      }
      const id = Number(params.id);
      const user_ids = (body as { user_ids?: unknown })?.user_ids;
      const r = setZoneMembers(db, zonesState, id, user_ids);
      if (!r.ok) {
        set.status = 404;
        return { ok: false, error: r.error };
      }
      broadcastZonesUpdated();
      sendMyZonesToAffected(r.affectedUserIds);
      return {
        member_user_ids: r.memberUserIds,
        dropped: r.dropped,
      };
    })
    .get("/api/zones/all-cells", ({ headers, set }) => {
      const auth = requireAdmin(headers.cookie ?? null);
      if (!auth.ok) {
        set.status = 403;
        return { ok: false };
      }
      const zones = [...world.zones.values()].map((z) => ({
        id: z.id,
        cells: [...z.cells].map((key) => {
          const [x, y] = key.split(",").map(Number);
          return [x, y] as [number, number];
        }),
      }));
      return { zones };
    })
    .get("/api/users", ({ headers, set }) => {
      const auth = requireAdmin(headers.cookie ?? null);
      if (!auth.ok) {
        set.status = 403;
        return { ok: false };
      }
      const users = db
        .query("SELECT id, display_name FROM users ORDER BY display_name")
        .all() as { id: string; display_name: string | null }[];
      return { users };
    })
    .ws("/ws", {
      open(ws) {
        const data = ws.data as {
          headers?: Record<string, string | undefined>;
        };
        const cookieHeader = data.headers?.cookie ?? null;
        const sessionId = parseSessionCookie(cookieHeader);
        if (!sessionId) {
          ws.close(4001, "unauthenticated");
          return;
        }
        const session = getSession(db, sessionId);
        if (!session) {
          ws.close(4001, "unauthenticated");
          return;
        }
        const user = getUserById(db, session.userId);
        if (!user) {
          ws.close(4001, "unauthenticated");
          return;
        }

        const displayName = user.displayName ?? user.username;
        const eid = onPlayerJoin(displayName);
        console.log(`client connected: eid=${eid}, user=${user.username}`);

        registerConnection(ws.raw, {
          eid,
          userId: user.id,
          username: user.username,
          displayName,
          isAdmin: user.isAdmin,
        });

        getObserverSerializers().set(
          ws.raw,
          createObserverSerializer(world, Networked, networkedComponents, {
            buffer: new ArrayBuffer(OBSERVER_BUFFER_SIZE),
          }),
        );

        ws.sendBinary(
          tagMessage(
            MESSAGE_TYPES.YOUR_EID,
            new Int32Array([
              PROTOCOL_VERSION,
              eid,
              world.bounds.x,
              world.bounds.y,
              world.bounds.w,
              world.bounds.h,
            ]).buffer,
          ),
        );
        ws.sendBinary(tagMessage(MESSAGE_TYPES.SNAPSHOT, getSnapshotPayload()));

        // Non-admins get an initial MY_ZONES so the client can paint
        // inside their zones without waiting for the next mutation
        // broadcast. Admins are skipped — they refetch via the REST
        // endpoints triggered by ZONES_UPDATED.
        if (!user.isAdmin) {
          sendMyZonesTo(user.id, paintableCellsFor(user.id));
        }
      },

      close(ws) {
        console.log("client disconnected");
        const connection = getPlayerConnections().get(ws.raw);
        if (connection) onPlayerLeave(connection.eid);
        unregisterConnection(ws.raw);
      },

      message(ws, message) {
        handleIncomingMessage(world, db, ws.raw, message);
      },
    });
};

export type App = ReturnType<typeof buildApp>;
