import { describe, expect, test } from "bun:test";
import {
  UnreliableDatagramLink,
  type NetworkProfile,
} from "../../tools/network-harness/src/unreliable-datagram-link";

const profile: NetworkProfile = {
  name: "test",
  roundTripLatencyMs: 100,
  jitterMs: 40,
  lossRate: 0.2,
  maxPacketLifetimeMs: 200,
  bandwidthBitsPerSecond: 1_000_000,
};

const run = () => {
  const link = new UnreliableDatagramLink<number>(profile, 42);
  for (let sequence = 0; sequence < 100; sequence += 1)
    link.send(sequence, 100, sequence);
  return {
    delivered: link.advance(1_000).map(({ payload }) => payload),
    metrics: link.metrics,
  };
};

describe("profiled unordered datagrams", () => {
  test("are seeded, bounded, lossy, and reorderable", () => {
    const first = run();
    expect(run()).toEqual(first);
    expect(first.metrics.droppedPackets).toBeGreaterThan(0);
    expect(first.metrics.deliveredPackets + first.metrics.droppedPackets).toBe(
      100,
    );
    expect(
      first.delivered.some(
        (value, index) => index > 0 && value < first.delivered[index - 1]!,
      ),
    ).toBe(true);
  });
});
