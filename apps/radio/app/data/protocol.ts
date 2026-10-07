export const NTP_CONSTANTS = {
  INITIAL_INTERVAL_MS: 50,
  STEADY_STATE_INTERVAL_MS: 2500,
  RESPONSE_TIMEOUT_MS: 3750,
  MAX_MEASUREMENTS: 16,
  MAX_HISTORY_MEASUREMENTS: 120,
  PROBE_GAP_MS: 25,
  PROBE_GAP_TOLERANCE_MS: 5,
} as const;

export type Track = {
  id: string;
  title: string;
  url: string;
  addedAt: number;
  mediaType?: string;
  upload?: {
    status: "uploading" | "failed";
    bytesReceived: number;
    sizeBytes: number;
  };
};

export type ClientInfo = {
  clientId: string;
  name: string;
  rtt: number;
  compensationMs: number;
  nudgeMs: number;
  joinedAt: number;
  lastSeenAt: number;
};

export type PlaybackState = {
  type: "paused" | "playing";
  trackId: string | null;
  trackTimeSeconds: number;
  serverTimeToExecute: number;
};

export type RoomSnapshot = {
  roomId: string;
  tracks: Track[];
  clients: ClientInfo[];
  playback: PlaybackState;
  volume: number;
};

export type ClientMessage =
  | {
      type: "JOIN";
      clientId: string;
    }
  | {
      type: "NTP_REQUEST";
      t0: number;
      clientRTT?: number;
      clientCompensationMs?: number;
      clientNudgeMs?: number;
      probeGroupId: number;
      probeGroupIndex: 0 | 1;
    }
  | {
      type: "TRACK_READY";
      trackId: string;
    }
  | {
      type: "PLAY";
      trackId: string;
      trackTimeSeconds: number;
    }
  | {
      type: "PAUSE";
      trackId: string;
      trackTimeSeconds: number;
    }
  | {
      type: "SET_VOLUME";
      volume: number;
    }
  | {
      type: "REMOVE_TRACK";
      trackId: string;
    }
  | {
      type: "RENAME_TRACK";
      trackId: string;
      title: string;
    }
  | {
      type: "TRACK_ENDED";
      trackId: string;
      trackTimeSeconds: number;
    }
  | {
      type: "REORDER_TRACKS";
      trackIds: string[];
    }
  | {
      type: "LIVENESS_PONG";
    };

export type ServerMessage =
  | {
      type: "ROOM_STATE";
      snapshot: RoomSnapshot;
    }
  | {
      type: "PRESENCE";
      clients: ClientInfo[];
    }
  | {
      type: "QUEUE_UPDATED";
      tracks: Track[];
    }
  | {
      type: "NTP_RESPONSE";
      t0: number;
      t1: number;
      t2: number;
      probeGroupId: number;
      probeGroupIndex: 0 | 1;
    }
  | {
      type: "LOAD_TRACK";
      track: Track;
    }
  | {
      type: "TRACK_BUFFERING";
      trackId: string;
      readyClientCount: number;
      totalClientCount: number;
    }
  | {
      type: "SCHEDULED_PLAY";
      trackId: string;
      trackTimeSeconds: number;
      serverTimeToExecute: number;
    }
  | {
      type: "SCHEDULED_PAUSE";
      trackId: string;
      trackTimeSeconds: number;
      serverTimeToExecute: number;
    }
  | {
      type: "VOLUME_UPDATED";
      volume: number;
    }
  | {
      type: "LIVENESS_PING";
    }
  | {
      type: "ERROR";
      message: string;
    };

export function epochNow(): number {
  return performance.timeOrigin + performance.now();
}

export function parseClientMessage(value: unknown): ClientMessage | null {
  if (!value || typeof value !== "object") return null;
  let message = value as Record<string, unknown>;
  if (typeof message.type !== "string") return null;

  switch (message.type) {
    case "JOIN":
      if (typeof message.clientId === "string") {
        return { type: "JOIN", clientId: message.clientId };
      }
      return null;
    case "NTP_REQUEST":
      if (
        typeof message.t0 === "number" &&
        typeof message.probeGroupId === "number" &&
        (message.probeGroupIndex === 0 || message.probeGroupIndex === 1)
      ) {
        return {
          type: "NTP_REQUEST",
          t0: message.t0,
          clientRTT:
            typeof message.clientRTT === "number"
              ? message.clientRTT
              : undefined,
          clientCompensationMs:
            typeof message.clientCompensationMs === "number"
              ? message.clientCompensationMs
              : undefined,
          clientNudgeMs:
            typeof message.clientNudgeMs === "number"
              ? message.clientNudgeMs
              : undefined,
          probeGroupId: message.probeGroupId,
          probeGroupIndex: message.probeGroupIndex,
        };
      }
      return null;
    case "TRACK_READY":
    case "REMOVE_TRACK":
      if (typeof message.trackId === "string")
        return { type: message.type, trackId: message.trackId };
      return null;
    case "RENAME_TRACK":
      if (
        typeof message.trackId === "string" &&
        typeof message.title === "string"
      ) {
        return {
          type: "RENAME_TRACK",
          trackId: message.trackId,
          title: message.title,
        };
      }
      return null;
    case "TRACK_ENDED":
      if (
        typeof message.trackId === "string" &&
        typeof message.trackTimeSeconds === "number"
      ) {
        return {
          type: "TRACK_ENDED",
          trackId: message.trackId,
          trackTimeSeconds: message.trackTimeSeconds,
        };
      }
      return null;
    case "PLAY":
    case "PAUSE":
      if (
        typeof message.trackId === "string" &&
        typeof message.trackTimeSeconds === "number"
      ) {
        return {
          type: message.type,
          trackId: message.trackId,
          trackTimeSeconds: message.trackTimeSeconds,
        };
      }
      return null;
    case "SET_VOLUME":
      if (typeof message.volume === "number")
        return { type: "SET_VOLUME", volume: message.volume };
      return null;
    case "REORDER_TRACKS":
      if (
        Array.isArray(message.trackIds) &&
        message.trackIds.every((id) => typeof id === "string")
      ) {
        return { type: "REORDER_TRACKS", trackIds: message.trackIds };
      }
      return null;
    case "LIVENESS_PONG":
      return { type: "LIVENESS_PONG" };
    default:
      return null;
  }
}

export function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

export function parseServerMessage(value: string): ServerMessage | null {
  try {
    let message = JSON.parse(value) as { type?: unknown };
    return typeof message.type === "string" ? (message as ServerMessage) : null;
  } catch {
    return null;
  }
}
