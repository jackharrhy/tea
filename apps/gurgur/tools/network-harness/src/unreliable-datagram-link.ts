export type NetworkProfile = {
  name: string;
  roundTripLatencyMs: number;
  jitterMs: number;
  lossRate: number;
  maxPacketLifetimeMs: number;
  bandwidthBitsPerSecond: number | null;
};

export type DatagramMetrics = {
  sentPackets: number;
  deliveredPackets: number;
  droppedPackets: number;
  sentBytes: number;
  deliveredBytes: number;
  queuedBytes: number;
  queueHighWaterBytes: number;
};

type DeliveredDatagram<T> = {
  sequence: number;
  payload: T;
  byteLength: number;
  sentAtMs: number;
  deliveryAtMs: number;
};

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export class UnreliableDatagramLink<T> {
  readonly profile: NetworkProfile;
  readonly #random: () => number;
  #nextSequence = 0;
  #transmitterAvailableAtMs = 0;
  #pending: Array<DeliveredDatagram<T>> = [];
  #metrics: DatagramMetrics = {
    sentPackets: 0,
    deliveredPackets: 0,
    droppedPackets: 0,
    sentBytes: 0,
    deliveredBytes: 0,
    queuedBytes: 0,
    queueHighWaterBytes: 0,
  };

  constructor(profile: NetworkProfile, seed: number) {
    if (
      profile.roundTripLatencyMs < 0 ||
      profile.jitterMs < 0 ||
      profile.lossRate < 0 ||
      profile.lossRate > 1 ||
      (profile.bandwidthBitsPerSecond !== null &&
        profile.bandwidthBitsPerSecond <= 0)
    )
      throw new Error("invalid network profile");
    this.profile = { ...profile };
    this.#random = mulberry32(seed);
  }

  send(sentAtMs: number, byteLength: number, payload: T): void {
    if (
      !Number.isFinite(sentAtMs) ||
      sentAtMs < 0 ||
      !Number.isInteger(byteLength) ||
      byteLength < 0
    )
      throw new Error("invalid datagram");
    this.#metrics.sentPackets += 1;
    this.#metrics.sentBytes += byteLength;
    const transmissionStart = Math.max(
      sentAtMs,
      this.#transmitterAvailableAtMs,
    );
    const serializationMs =
      this.profile.bandwidthBitsPerSecond === null
        ? 0
        : (byteLength * 8 * 1_000) / this.profile.bandwidthBitsPerSecond;
    const transmissionEnd = transmissionStart + serializationMs;
    this.#transmitterAvailableAtMs = transmissionEnd;
    // Profiles describe end-to-end jitter; each one-way impairment contributes half.
    const jitter = (this.#random() * 2 - 1) * (this.profile.jitterMs / 2);
    const deliveryAtMs = Math.max(
      transmissionEnd,
      transmissionEnd + this.profile.roundTripLatencyMs / 2 + jitter,
    );
    if (
      this.#random() < this.profile.lossRate ||
      deliveryAtMs - sentAtMs > this.profile.maxPacketLifetimeMs
    ) {
      this.#metrics.droppedPackets += 1;
      return;
    }
    this.#pending.push({
      sequence: this.#nextSequence++,
      payload,
      byteLength,
      sentAtMs,
      deliveryAtMs,
    });
    this.#metrics.queuedBytes += byteLength;
    this.#metrics.queueHighWaterBytes = Math.max(
      this.#metrics.queueHighWaterBytes,
      this.#metrics.queuedBytes,
    );
  }

  advance(nowMs: number): Array<DeliveredDatagram<T>> {
    const delivered: Array<DeliveredDatagram<T>> = [];
    const pending: Array<DeliveredDatagram<T>> = [];
    for (const packet of this.#pending) {
      if (packet.deliveryAtMs <= nowMs) delivered.push(packet);
      else pending.push(packet);
    }
    this.#pending = pending;
    delivered.sort(
      (left, right) =>
        left.deliveryAtMs - right.deliveryAtMs ||
        left.sequence - right.sequence,
    );
    for (const packet of delivered) {
      this.#metrics.deliveredPackets += 1;
      this.#metrics.deliveredBytes += packet.byteLength;
      this.#metrics.queuedBytes -= packet.byteLength;
    }
    return delivered;
  }

  get metrics(): Readonly<DatagramMetrics> {
    return { ...this.#metrics };
  }
}
