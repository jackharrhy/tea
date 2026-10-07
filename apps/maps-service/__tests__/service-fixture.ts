import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { createStarterDocument, parseMapSource } from "@tea/maps-editor/core";
import { FileBlobStore } from "../src/blob-store.js";
import { RemoteBuildQueue } from "../src/build-queue.js";
import { WorldviewDatabase, type WorldviewUser } from "../src/database.js";
import type {
  HostedMapCheckpoint,
  HostedMapSnapshot,
} from "../src/map-cell-client.js";
import { createWorldviewService } from "../src/server.js";
import type { WorldviewMcpAuthConfig } from "../src/mcp-auth.js";

export const TEST_REALTIME_TICKET_SECRET =
  "test-worldview-realtime-ticket-secret-0001";

export class FakeMapCells {
  readonly snapshots = new Map<string, HostedMapSnapshot>();
  readonly checkpoints: { mapId: string; name: string }[] = [];
  readonly savedCheckpoints: {
    mapId: string;
    checkpoint: HostedMapCheckpoint;
    source: string;
  }[] = [];

  async initialize(mapId: string, source: string): Promise<HostedMapSnapshot> {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(source),
    );
    const snapshot = {
      mapId,
      mapVersion: 0,
      document: createStarterDocument(),
      source,
      sourceSha256: Buffer.from(digest).toString("hex"),
    };
    this.snapshots.set(mapId, snapshot);
    return snapshot;
  }

  async snapshot(mapId: string): Promise<HostedMapSnapshot> {
    const snapshot = this.snapshots.get(mapId);
    if (!snapshot) throw new Error("MapCell is not initialized");
    return snapshot;
  }

  async replaceSource(
    mapId: string,
    _actorId: string,
    expectedMapVersion: number,
    expectedSourceSha256: string,
    source: string,
  ) {
    const current = await this.snapshot(mapId);
    if (
      current.mapVersion !== expectedMapVersion ||
      current.sourceSha256 !== expectedSourceSha256
    ) {
      return {
        status: "conflict" as const,
        mapVersion: current.mapVersion,
        sourceSha256: current.sourceSha256,
      };
    }
    if (current.source === source)
      return { status: "replaced" as const, map: current };
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(source),
    );
    const next = {
      ...current,
      mapVersion: current.mapVersion + 1,
      document: parseMapSource(source).document,
      source,
      sourceSha256: Buffer.from(digest).toString("hex"),
    };
    this.snapshots.set(mapId, next);
    return { status: "replaced" as const, map: next };
  }

  async createCheckpoint(
    mapId: string,
    name: string,
    actorId: string,
  ): Promise<HostedMapCheckpoint> {
    this.checkpoints.push({ mapId, name });
    const snapshot = await this.snapshot(mapId);
    const checkpoint = {
      id: "checkpoint-1",
      name,
      mapVersion: snapshot.mapVersion,
      sourceSha256: snapshot.sourceSha256,
      createdBy: actorId,
      createdAt: Date.now(),
    };
    this.savedCheckpoints.push({ mapId, checkpoint, source: snapshot.source });
    return checkpoint;
  }

  async listCheckpoints(
    mapId: string,
  ): Promise<readonly HostedMapCheckpoint[]> {
    return this.savedCheckpoints
      .filter((saved) => saved.mapId === mapId)
      .toReversed()
      .map((saved) => saved.checkpoint);
  }

  async checkpointSource(mapId: string, checkpointId: string) {
    const saved = this.savedCheckpoints.find(
      (item) => item.mapId === mapId && item.checkpoint.id === checkpointId,
    );
    if (!saved) return null;
    return {
      checkpoint: saved.checkpoint,
      source: saved.source,
    };
  }
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

export async function fixture(
  fetchImpl?: typeof fetch,
  compilerFetch?: typeof fetch,
  additionalPublicOrigins?: readonly string[],
  mcpAuth?: WorldviewMcpAuthConfig,
) {
  const root = await mkdtemp(join(tmpdir(), "tea-maps-service-test-"));
  const database = new WorldviewDatabase(join(root, "maps.db"));
  const maps = new FakeMapCells();
  const blobs = new FileBlobStore(join(root, "blobs"));
  const options = {
    database,
    blobs,
    oauth: {
      fourmUrl: "https://4orm.example",
      clientId: "worldview",
      publicUrl: "http://127.0.0.1",
    },
    ...(additionalPublicOrigins ? { additionalPublicOrigins } : {}),
    ...(mcpAuth ? { mcpAuth } : {}),
    realtimeTicketSecret: TEST_REALTIME_TICKET_SECRET,
    maps,
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
    ...(compilerFetch
      ? {
          builds: new RemoteBuildQueue(
            database,
            blobs,
            { quake: "http://compiler.internal" },
            compilerFetch,
          ),
        }
      : {}),
  };
  const server = createWorldviewService(options);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Server has no address");
  const origin = `http://127.0.0.1:${address.port}`;
  cleanups.push(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    database.close();
    await rm(root, { recursive: true, force: true });
  });
  return { origin, root, database, maps, blobs, options };
}

export function session(
  database: WorldviewDatabase,
  profile: Omit<WorldviewUser, "id"> = {
    fourmSub: "fourm-1",
    username: "mapper",
    displayName: "Mapper",
    isAdmin: false,
  },
) {
  const user = database.upsertUser(profile);
  return {
    user,
    cookie: `tea_maps_session=${database.createSession(user.id).token}`,
  };
}
