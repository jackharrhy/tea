import type {
  HostedCheckpoint,
  HostedCheckpointSource,
  HostedMapSnapshot,
  ReplaceHostedMapSourceResult,
} from "@tea/maps-protocol";

import type { ArtbinClient } from "./artbin.js";
import type { BlobStore } from "./blob-store.js";
import type { RemoteBuildQueue } from "./build-queue.js";
import type { WorldviewDatabase } from "./database.js";
import type { OAuthConfig } from "./oauth.js";
import type { WorldviewMcpAuthConfig } from "./mcp-auth.js";

export interface HostedMapStore {
  initialize(mapId: string, source: string): Promise<HostedMapSnapshot>;
  snapshot(mapId: string): Promise<HostedMapSnapshot>;
  createCheckpoint(
    mapId: string,
    name: string,
    actorId: string,
  ): Promise<HostedCheckpoint>;
  listCheckpoints(mapId: string): Promise<readonly HostedCheckpoint[]>;
  checkpointSource(
    mapId: string,
    checkpointId: string,
  ): Promise<HostedCheckpointSource | null>;
  replaceSource(
    mapId: string,
    actorId: string,
    expectedMapVersion: number,
    expectedSourceSha256: string,
    source: string,
  ): Promise<ReplaceHostedMapSourceResult>;
}

export interface WorldviewServiceOptions {
  readonly database: WorldviewDatabase;
  readonly blobs: BlobStore;
  readonly oauth: OAuthConfig;
  readonly mcpAuth?: WorldviewMcpAuthConfig;
  readonly additionalPublicOrigins?: readonly string[];
  readonly staticRoot?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly realtimeTicketSecret: string;
  readonly maps: HostedMapStore;
  readonly artbin?: ArtbinClient;
  readonly builds?: RemoteBuildQueue;
}
