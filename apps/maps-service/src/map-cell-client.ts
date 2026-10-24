import { signRealtimeTicket } from "./realtime-ticket.js";
import {
  HostedCheckpointResponseSchema,
  HostedCheckpointsResponseSchema,
  HostedCheckpointSourceResponseSchema,
  HostedMapSnapshotSchema,
  ReplaceHostedMapSourceResultSchema,
  type HostedCheckpoint as HostedMapCheckpoint,
  type HostedMapSnapshot,
  type HostedCheckpointSource,
  type ReplaceHostedMapSourceResult,
} from "@tea/maps-protocol";

export type {
  HostedCheckpoint as HostedMapCheckpoint,
  HostedMapSnapshot,
} from "@tea/maps-protocol";

export class MapCellClient {
  public constructor(
    private readonly endpoint: string,
    private readonly secret: string,
    private readonly fetcher: typeof globalThis.fetch = globalThis.fetch,
  ) {}

  private ticket(mapId: string, actorId = "tea-maps-service"): string {
    return signRealtimeTicket(
      {
        version: 2,
        mapId,
        principalId: "tea-maps-service",
        actorId,
        role: "owner",
        expiresAt: Date.now() + 60_000,
      },
      this.secret,
    );
  }

  private async request(
    mapId: string,
    action: string,
    init: RequestInit = {},
    actorId?: string,
  ): Promise<Response> {
    const headers = new Headers({
      Authorization: `Bearer ${this.ticket(mapId, actorId)}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    });
    new Headers(init.headers).forEach((value, name) =>
      headers.set(name, value),
    );
    const response = await this.fetcher(
      new URL(
        `/sync/maps/${encodeURIComponent(mapId)}/${action}`,
        this.endpoint,
      ),
      {
        ...init,
        headers,
      },
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(
        `MapCell ${action} failed (${response.status}): ${detail}`,
      );
    }
    return response;
  }

  public async initialize(
    mapId: string,
    source: string,
  ): Promise<HostedMapSnapshot> {
    const payload: unknown = await (
      await this.request(mapId, "initialize", {
        method: "PUT",
        body: JSON.stringify({ source }),
      })
    ).json();
    return HostedMapSnapshotSchema.parse(payload);
  }

  public async snapshot(mapId: string): Promise<HostedMapSnapshot> {
    const payload: unknown = await (
      await this.request(mapId, "snapshot")
    ).json();
    return HostedMapSnapshotSchema.parse(payload);
  }

  public async replaceSource(
    mapId: string,
    actorId: string,
    expectedMapVersion: number,
    expectedSourceSha256: string,
    source: string,
  ): Promise<ReplaceHostedMapSourceResult> {
    const response = await this.fetcher(
      new URL(`/sync/maps/${encodeURIComponent(mapId)}/source`, this.endpoint),
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.ticket(mapId, actorId)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expectedMapVersion,
          expectedSourceSha256,
          source,
        }),
      },
    );
    if (response.status !== 200 && response.status !== 409) {
      throw new Error(`MapCell source replacement failed (${response.status})`);
    }
    const result = ReplaceHostedMapSourceResultSchema.parse(
      await response.json(),
    );
    if ((response.status === 200) !== (result.status === "replaced")) {
      throw new Error("MapCell source replacement status mismatch");
    }
    return result;
  }

  public async createCheckpoint(
    mapId: string,
    name: string,
    actorId: string,
  ): Promise<HostedMapCheckpoint> {
    const payload: unknown = await (
      await this.request(
        mapId,
        "checkpoints",
        {
          method: "POST",
          body: JSON.stringify({ name }),
        },
        actorId,
      )
    ).json();
    return HostedCheckpointResponseSchema.parse(payload).checkpoint;
  }

  public async listCheckpoints(
    mapId: string,
  ): Promise<readonly HostedMapCheckpoint[]> {
    const payload: unknown = await (
      await this.request(mapId, "checkpoints")
    ).json();
    return HostedCheckpointsResponseSchema.parse(payload).checkpoints;
  }

  public async checkpointSource(
    mapId: string,
    checkpointId: string,
  ): Promise<HostedCheckpointSource | null> {
    const response = await this.fetcher(
      new URL(
        `/sync/maps/${encodeURIComponent(mapId)}/checkpoints/${encodeURIComponent(checkpointId)}`,
        this.endpoint,
      ),
      { headers: { Authorization: `Bearer ${this.ticket(mapId)}` } },
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`MapCell checkpoint read failed (${response.status})`);
    }
    return HostedCheckpointSourceResponseSchema.parse(await response.json());
  }
}
