import {
  CreateHostedCheckpointRequestSchema,
  HostedCheckpointResponseSchema,
  HostedCheckpointSourceResponseSchema,
  HostedCheckpointsResponseSchema,
  HostedErrorResponseSchema,
} from "@tea/maps-protocol";
import { readHostedApi } from "./hosted-api.ts";

export async function listHostedCheckpoints(mapId: string) {
  const response = await readHostedApi(
    `/api/maps/${encodeURIComponent(mapId)}/checkpoints`,
    HostedCheckpointsResponseSchema,
  );
  return response.checkpoints;
}

export async function readHostedCheckpointSource(
  mapId: string,
  checkpointId: string,
) {
  return readHostedApi(
    `/api/maps/${encodeURIComponent(mapId)}/checkpoints/${encodeURIComponent(checkpointId)}`,
    HostedCheckpointSourceResponseSchema,
  );
}

export async function createHostedCheckpoint(mapId: string, name: string) {
  const request = CreateHostedCheckpointRequestSchema.parse({ name });
  const response = await fetch(
    `/api/maps/${encodeURIComponent(mapId)}/checkpoints`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    },
  );
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = HostedErrorResponseSchema.safeParse(payload);
    throw new Error(
      error.success ? error.data.error : `Request failed (${response.status})`,
    );
  }
  return HostedCheckpointResponseSchema.parse(payload).checkpoint;
}
