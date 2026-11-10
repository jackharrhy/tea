import type { NetworkProfile } from "./unreliable-datagram-link";

export const NETWORK_PROFILES = {
  local: {
    name: "local",
    roundTripLatencyMs: 2,
    jitterMs: 0,
    lossRate: 0,
    maxPacketLifetimeMs: 250,
    bandwidthBitsPerSecond: null,
  },
  typical: {
    name: "typical",
    roundTripLatencyMs: 80,
    jitterMs: 20,
    lossRate: 0.01,
    maxPacketLifetimeMs: 250,
    bandwidthBitsPerSecond: 10_000_000,
  },
  adverse: {
    name: "adverse",
    roundTripLatencyMs: 150,
    jitterMs: 40,
    lossRate: 0.05,
    maxPacketLifetimeMs: 250,
    bandwidthBitsPerSecond: null,
  },
} as const satisfies Record<string, NetworkProfile>;
