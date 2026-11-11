import {
  PHYSICS_HZ,
  NETWORK_FLAG_AWAKE,
  NETWORK_FLAG_HELD,
  RENDER_INTERPOLATION_MAX_TICKS,
  RENDER_INTERPOLATION_MIN_TICKS,
  cloneNetworkState,
  isStaleNetworkState,
  unwrapTick32,
  type BodySnapshot,
  type NetworkObjectState,
  type RuntimeId,
  type Vec3,
} from "@harrhy/gurgur-engine";
import { Quaternion } from "three";

type TimedState = {
  receivedAtMs: number;
  timelineTick: number;
  state: NetworkObjectState;
};

type NetworkTrack = {
  delayTicks: number;
  desiredDelayTicks: number;
  underrunRequiredTicks: number;
  underrunHoldUntilMs: number;
  lastAdaptiveSampleMs: number;
  underrunSamples: number;
  latenessSamples: Array<{ receivedAtMs: number; ticks: number }>;
  samples: TimedState[];
  visualCorrection: {
    offset: Vec3;
    rotation: BodySnapshot["rotation"];
    startedAtMs: number;
  } | null;
};

type LocalSample = { producedAtMs: number; state: NetworkObjectState };
type LocalTrack = { previous: LocalSample | null; current: LocalSample };
type ClockAnchor = { serverTick: number; localAtServerTickMs: number };

export type PresentationBufferDiagnostics = {
  networkDelayPolicy: "adaptive-render";
  minimumNetworkDelayTicks: number;
  networkDelayTicks: number;
  desiredNetworkDelayTicks: number;
  underrunSamples: number;
  trackDelayTicks: Record<string, number>;
};

const LOCAL_BODY_DELAY_MS = 1_000 / PHYSICS_HZ;
const LATENESS_WINDOW_MS = 10_000;
const UNDERRUN_HOLD_MS = 500;
const DELAY_BUILD_RATE_TICKS_PER_TICK = 0.9;
const DELAY_RELEASE_RATE_TICKS_PER_SECOND = 2;
const MAX_REMOTE_EXTRAPOLATION_TICKS = 3;
const REMOTE_CORRECTION_MS = 120;
const MAX_REMOTE_CORRECTION_METRES = 0.5;

export class PresentationBuffer {
  readonly #networkTracks = new Map<string, NetworkTrack>();
  readonly #localTracks = new Map<string, LocalTrack>();
  readonly #latestNetwork = new Map<string, NetworkObjectState>();
  #clock: ClockAnchor | null = null;

  reset(states: readonly NetworkObjectState[], receivedAtMs: number): void {
    this.#networkTracks.clear();
    this.#localTracks.clear();
    this.#latestNetwork.clear();
    this.#clock = null;
    this.pushNetwork(states, receivedAtMs);
  }

  updateClock(
    serverTick: number,
    receivedAtMs: number,
    oneWayDelayMs: number,
  ): void {
    if (
      !Number.isSafeInteger(serverTick) ||
      serverTick < 0 ||
      !Number.isFinite(receivedAtMs) ||
      !Number.isFinite(oneWayDelayMs)
    )
      return;
    this.#clock = {
      serverTick,
      localAtServerTickMs: receivedAtMs - Math.max(0, oneWayDelayMs),
    };
  }

  pushNetwork(
    states: readonly NetworkObjectState[],
    receivedAtMs: number,
  ): void {
    for (const state of states) {
      const identity = idKey(state.id);
      const previous = this.#latestNetwork.get(identity);
      if (previous && isStaleNetworkState(state, previous)) continue;
      const snapshot = cloneNetworkState(state);
      this.#latestNetwork.set(identity, snapshot);
      if (this.#localTracks.has(identity)) continue;
      let track = this.#networkTracks.get(identity);
      if (
        !track ||
        track.samples[0]!.state.authorityVersion !== state.authorityVersion
      ) {
        track = createNetworkTrack(snapshot, receivedAtMs);
        this.#networkTracks.set(identity, track);
      } else {
        const latest = track.samples.at(-1)!;
        if (latest.state.stateSequence === state.stateSequence) continue;
        const previousPresentation = presentedNetworkTrack(
          track,
          this.#clockTick(track, receivedAtMs) -
            (sharedActorTrack(track)
              ? sharedActorDelay(this.#networkTracks.values())
              : track.delayTicks),
          receivedAtMs,
        );
        const timelineTick = unwrapTick32(
          state.sourceTick,
          latest.timelineTick,
        );
        const sample = { receivedAtMs, timelineTick, state: snapshot };
        if (timelineTick === latest.timelineTick)
          track.samples[track.samples.length - 1] = sample;
        else track.samples.push(sample);
        while (track.samples.length > 64) track.samples.shift();
        const cutoff = timelineTick - PHYSICS_HZ * 2;
        while (
          track.samples.length > 2 &&
          track.samples[1]!.timelineTick < cutoff
        )
          track.samples.shift();
        const nextPresentation = sampleTrack(
          track,
          this.#clockTick(track, receivedAtMs) -
            (sharedActorTrack(track)
              ? sharedActorDelay(this.#networkTracks.values())
              : track.delayTicks),
        );
        const offset = {
          x: previousPresentation.position.x - nextPresentation.position.x,
          y: previousPresentation.position.y - nextPresentation.position.y,
          z: previousPresentation.position.z - nextPresentation.position.z,
        };
        const distance = Math.hypot(offset.x, offset.y, offset.z);
        const rotation = quaternion(previousPresentation.rotation).multiply(
          quaternion(nextPresentation.rotation).invert(),
        );
        const angle = rotation.angleTo(new Quaternion());
        track.visualCorrection =
          (distance > 0.001 || angle > 0.001) &&
          distance <= MAX_REMOTE_CORRECTION_METRES &&
          angle <= Math.PI / 2
            ? {
                offset,
                rotation: {
                  x: rotation.x,
                  y: rotation.y,
                  z: rotation.z,
                  w: rotation.w,
                },
                startedAtMs: receivedAtMs,
              }
            : null;
      }
      if (!this.#clock || !activeNetworkState(state)) continue;
      track.latenessSamples.push({
        receivedAtMs,
        ticks: Math.max(
          0,
          this.#clockTick(track, receivedAtMs) -
            track.samples.at(-1)!.timelineTick,
        ),
      });
      this.#pruneLateness(track, receivedAtMs);
      const measured = this.#measuredDelayTicks(track);
      track.desiredDelayTicks =
        receivedAtMs < track.underrunHoldUntilMs
          ? Math.max(measured, track.underrunRequiredTicks)
          : measured;
    }
  }

  pushLocal(
    states: readonly NetworkObjectState[],
    producedAtMs: number,
    reconciled = false,
  ): void {
    for (const state of states) {
      const identity = idKey(state.id);
      const track = this.#localTracks.get(identity);
      this.#networkTracks.delete(identity);
      if (
        !track ||
        track.current.state.authorityVersion !== state.authorityVersion
      ) {
        this.#localTracks.set(identity, {
          previous: null,
          current: { producedAtMs, state: cloneNetworkState(state) },
        });
        continue;
      }
      if (reconciled) {
        // Shift the older endpoint with the correction; render interpolation must not undo it.
        if (track.previous) {
          const previous = track.previous.state;
          const current = track.current.state;
          previous.position.x += state.position.x - current.position.x;
          previous.position.y += state.position.y - current.position.y;
          previous.position.z += state.position.z - current.position.z;
          const rotation = quaternion(state.rotation)
            .multiply(quaternion(current.rotation).invert())
            .multiply(quaternion(previous.rotation));
          previous.rotation = {
            x: rotation.x,
            y: rotation.y,
            z: rotation.z,
            w: rotation.w,
          };
        }
        track.current.state = cloneNetworkState(state);
      } else {
        if (producedAtMs !== track.current.producedAtMs)
          track.previous = track.current;
        track.current = { producedAtMs, state: cloneNetworkState(state) };
      }
    }
  }

  replaceReliable(state: NetworkObjectState, receivedAtMs: number): void {
    const identity = idKey(state.id);
    const snapshot = cloneNetworkState(state);
    this.#localTracks.delete(identity);
    this.#networkTracks.set(
      identity,
      createNetworkTrack(snapshot, receivedAtMs),
    );
    this.#latestNetwork.set(identity, snapshot);
  }

  remove(id: RuntimeId): void {
    const identity = idKey(id);
    this.#networkTracks.delete(identity);
    this.#localTracks.delete(identity);
    this.#latestNetwork.delete(identity);
  }

  sample(nowMs: number): BodySnapshot[] {
    const bodies: BodySnapshot[] = [];
    for (const track of this.#networkTracks.values())
      this.#adaptNetworkDelay(track, nowMs);
    const actorDelay = sharedActorDelay(this.#networkTracks.values());
    for (const track of this.#networkTracks.values()) {
      const delayTicks = sharedActorTrack(track)
        ? actorDelay
        : track.delayTicks;
      bodies.push(
        presentedNetworkTrack(
          track,
          this.#clockTick(track, nowMs) - delayTicks,
          nowMs,
        ),
      );
    }
    for (const { previous, current } of this.#localTracks.values()) {
      if (!previous) {
        bodies.push(toBodySnapshot(current.state));
        continue;
      }
      const spanMs = current.producedAtMs - previous.producedAtMs;
      if (spanMs <= 0) {
        bodies.push(toBodySnapshot(current.state));
        continue;
      }
      if (
        current.state.kind === "player" ||
        (current.state.flags & NETWORK_FLAG_HELD) !== 0
      ) {
        const amount = clamp((nowMs - current.producedAtMs) / spanMs, 0, 1);
        bodies.push(interpolate(previous.state, current.state, 1 + amount));
        continue;
      }
      const amount = clamp(
        (nowMs - LOCAL_BODY_DELAY_MS - previous.producedAtMs) / spanMs,
        0,
        1,
      );
      if (amount <= 0) bodies.push(toBodySnapshot(previous.state));
      else if (amount >= 1) bodies.push(toBodySnapshot(current.state));
      else bodies.push(interpolate(previous.state, current.state, amount));
    }
    return bodies;
  }

  diagnostics(): PresentationBufferDiagnostics {
    const tracks = [...this.#networkTracks.values()];
    const delays = tracks.map((track) => track.delayTicks);
    const desired = tracks.map((track) => track.desiredDelayTicks);
    const trackDelayTicks: Record<string, number> = {};
    const actorDelay = sharedActorDelay(this.#networkTracks.values());
    for (const [identity, track] of this.#networkTracks)
      trackDelayTicks[identity] = sharedActorTrack(track)
        ? actorDelay
        : track.delayTicks;
    for (const [identity, track] of this.#localTracks)
      trackDelayTicks[identity] = track.current.state.kind === "body" ? 1 : 0;
    return {
      networkDelayPolicy: "adaptive-render",
      minimumNetworkDelayTicks: delays.length
        ? Math.min(...delays)
        : RENDER_INTERPOLATION_MIN_TICKS,
      networkDelayTicks: delays.length
        ? Math.max(...delays)
        : RENDER_INTERPOLATION_MIN_TICKS,
      desiredNetworkDelayTicks: desired.length
        ? Math.max(...desired)
        : RENDER_INTERPOLATION_MIN_TICKS,
      underrunSamples: tracks.reduce(
        (sum, track) => sum + track.underrunSamples,
        0,
      ),
      trackDelayTicks,
    };
  }

  trackDelayTicks(id: RuntimeId): number | null {
    const identity = idKey(id);
    const local = this.#localTracks.get(identity);
    if (local) return local.current.state.kind === "body" ? 1 : 0;
    const track = this.#networkTracks.get(identity);
    if (!track) return null;
    return sharedActorTrack(track)
      ? sharedActorDelay(this.#networkTracks.values())
      : track.delayTicks;
  }

  latestNetwork(id: RuntimeId): BodySnapshot | null {
    const latest = this.#latestNetwork.get(idKey(id));
    return latest ? toBodySnapshot(latest) : null;
  }

  latestLocal(id: RuntimeId): BodySnapshot | null {
    const track = this.#localTracks.get(idKey(id));
    return track ? toBodySnapshot(track.current.state) : null;
  }

  #adaptNetworkDelay(track: NetworkTrack, nowMs: number): void {
    if (!Number.isFinite(nowMs)) return;
    const elapsedSeconds = Math.max(
      0,
      (nowMs - track.lastAdaptiveSampleMs) / 1_000,
    );
    track.lastAdaptiveSampleMs = nowMs;
    this.#pruneLateness(track, nowMs);

    const latest = track.samples.at(-1)!;
    const required = Math.ceil(
      Math.max(0, this.#clockTick(track, nowMs) - latest.timelineTick + 1),
    );
    const underrun =
      track.samples.length >= 2 &&
      latest.timelineTick - track.samples[0]!.timelineTick >=
        RENDER_INTERPOLATION_MIN_TICKS &&
      nowMs - latest.receivedAtMs <= 250 &&
      activeNetworkState(latest.state) &&
      track.delayTicks + 1e-6 < required;
    if (underrun) {
      track.underrunSamples += 1;
      track.underrunRequiredTicks = clamp(
        required,
        RENDER_INTERPOLATION_MIN_TICKS,
        RENDER_INTERPOLATION_MAX_TICKS,
      );
      track.underrunHoldUntilMs = nowMs + UNDERRUN_HOLD_MS;
      track.desiredDelayTicks = Math.max(
        track.desiredDelayTicks,
        track.underrunRequiredTicks,
      );
    } else if (nowMs >= track.underrunHoldUntilMs) {
      track.desiredDelayTicks = this.#measuredDelayTicks(track);
    }

    if (track.desiredDelayTicks > track.delayTicks) {
      track.delayTicks = Math.min(
        track.desiredDelayTicks,
        track.delayTicks +
          elapsedSeconds * PHYSICS_HZ * DELAY_BUILD_RATE_TICKS_PER_TICK,
      );
    } else {
      track.delayTicks = Math.max(
        track.desiredDelayTicks,
        track.delayTicks - elapsedSeconds * DELAY_RELEASE_RATE_TICKS_PER_SECOND,
      );
    }
  }

  #measuredDelayTicks(track: NetworkTrack): number {
    const sorted = track.latenessSamples
      .map((sample) => sample.ticks)
      .toSorted((a, b) => a - b);
    const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
    return clamp(
      Math.ceil(p95 + 1),
      RENDER_INTERPOLATION_MIN_TICKS,
      RENDER_INTERPOLATION_MAX_TICKS,
    );
  }

  #clockTick(track: NetworkTrack, nowMs: number): number {
    const latest = track.samples.at(-1)!;
    return this.#clock
      ? alignClockTick(
          this.#clock.serverTick +
            ((nowMs - this.#clock.localAtServerTickMs) / 1_000) * PHYSICS_HZ,
          latest.timelineTick,
        )
      : latest.timelineTick +
          (Math.max(0, nowMs - latest.receivedAtMs) / 1_000) * PHYSICS_HZ;
  }

  #pruneLateness(track: NetworkTrack, nowMs: number): void {
    const cutoff = nowMs - LATENESS_WINDOW_MS;
    while (
      track.latenessSamples.length > 0 &&
      track.latenessSamples[0]!.receivedAtMs < cutoff
    )
      track.latenessSamples.shift();
  }
}

function createNetworkTrack(
  state: NetworkObjectState,
  receivedAtMs: number,
): NetworkTrack {
  return {
    delayTicks: RENDER_INTERPOLATION_MIN_TICKS,
    desiredDelayTicks: RENDER_INTERPOLATION_MIN_TICKS,
    underrunRequiredTicks: RENDER_INTERPOLATION_MIN_TICKS,
    underrunHoldUntilMs: 0,
    lastAdaptiveSampleMs: receivedAtMs,
    underrunSamples: 0,
    latenessSamples: [],
    samples: [{ receivedAtMs, timelineTick: state.sourceTick, state }],
    visualCorrection: null,
  };
}

function activeNetworkState(state: NetworkObjectState): boolean {
  return (
    state.kind === "player" ||
    (state.flags & (NETWORK_FLAG_AWAKE | NETWORK_FLAG_HELD)) !== 0 ||
    Math.hypot(
      state.linearVelocity.x,
      state.linearVelocity.y,
      state.linearVelocity.z,
      state.angularVelocity.x,
      state.angularVelocity.y,
      state.angularVelocity.z,
    ) > 1e-4
  );
}

function sharedActorTrack(track: NetworkTrack): boolean {
  const state = track.samples.at(-1)!.state;
  return state.kind === "player" || (state.flags & NETWORK_FLAG_HELD) !== 0;
}

function sharedActorDelay(tracks: Iterable<NetworkTrack>): number {
  let delay = RENDER_INTERPOLATION_MIN_TICKS;
  for (const track of tracks)
    if (sharedActorTrack(track)) delay = Math.max(delay, track.delayTicks);
  return delay;
}

function sampleTrack(track: NetworkTrack, targetTick: number): BodySnapshot {
  const samples = track.samples;
  if (samples.length === 1 || targetTick <= samples[0]!.timelineTick)
    return toBodySnapshot(samples[0]!.state);
  const latest = samples.at(-1)!;
  if (targetTick >= latest.timelineTick) {
    const extraTicks = Math.min(
      targetTick - latest.timelineTick,
      MAX_REMOTE_EXTRAPOLATION_TICKS,
    );
    const previous = samples.at(-2);
    if (
      extraTicks <= 0 ||
      !previous ||
      !(
        latest.state.kind === "player" ||
        (latest.state.flags & (NETWORK_FLAG_AWAKE | NETWORK_FLAG_HELD)) !== 0
      )
    )
      return toBodySnapshot(latest.state);
    const spanTicks = latest.timelineTick - previous.timelineTick;
    if (spanTicks <= 0) return toBodySnapshot(latest.state);
    const seconds = extraTicks / PHYSICS_HZ;
    const velocity =
      latest.state.kind === "player"
        ? {
            x:
              (latest.state.position.x - previous.state.position.x) /
              (spanTicks / PHYSICS_HZ),
            y:
              (latest.state.position.y - previous.state.position.y) /
              (spanTicks / PHYSICS_HZ),
            z:
              (latest.state.position.z - previous.state.position.z) /
              (spanTicks / PHYSICS_HZ),
          }
        : latest.state.linearVelocity;
    const speed = Math.hypot(velocity.x, velocity.y, velocity.z);
    if (speed > (latest.state.kind === "player" ? 7 : 30))
      return toBodySnapshot(latest.state);
    return {
      ...toBodySnapshot(latest.state),
      position: {
        x: latest.state.position.x + velocity.x * seconds,
        y: latest.state.position.y + velocity.y * seconds,
        z: latest.state.position.z + velocity.z * seconds,
      },
      rotation: mixQuat(
        previous.state.rotation,
        latest.state.rotation,
        1 + extraTicks / spanTicks,
      ),
    };
  }
  for (let index = 1; index < samples.length; index += 1) {
    const next = samples[index]!;
    if (next.timelineTick < targetTick) continue;
    const previous = samples[index - 1]!;
    const span = next.timelineTick - previous.timelineTick;
    const amount = span <= 0 ? 1 : (targetTick - previous.timelineTick) / span;
    return interpolate(previous.state, next.state, amount);
  }
  return toBodySnapshot(latest.state);
}

function presentedNetworkTrack(
  track: NetworkTrack,
  targetTick: number,
  nowMs: number,
): BodySnapshot {
  const body = sampleTrack(track, targetTick);
  const correction = track.visualCorrection;
  if (!correction) return body;
  const remaining =
    1 - clamp((nowMs - correction.startedAtMs) / REMOTE_CORRECTION_MS, 0, 1);
  if (remaining <= 0) {
    track.visualCorrection = null;
    return body;
  }
  const rotation = new Quaternion()
    .slerp(quaternion(correction.rotation), remaining)
    .multiply(quaternion(body.rotation));
  return {
    ...body,
    position: {
      x: body.position.x + correction.offset.x * remaining,
      y: body.position.y + correction.offset.y * remaining,
      z: body.position.z + correction.offset.z * remaining,
    },
    rotation: {
      x: rotation.x,
      y: rotation.y,
      z: rotation.z,
      w: rotation.w,
    },
  };
}

function alignClockTick(clockTick: number, reference: number): number {
  const whole = Math.floor(clockTick);
  return unwrapTick32(whole >>> 0, reference) + (clockTick - whole);
}

function interpolate(
  previous: NetworkObjectState,
  next: NetworkObjectState,
  amount: number,
): BodySnapshot {
  return {
    id: { ...next.id },
    position: mixVec3(previous.position, next.position, amount),
    rotation: mixQuat(previous.rotation, next.rotation, amount),
    linearVelocity: mixVec3(
      previous.linearVelocity,
      next.linearVelocity,
      amount,
    ),
    angularVelocity: mixVec3(
      previous.angularVelocity,
      next.angularVelocity,
      amount,
    ),
    flags: next.flags,
  };
}

function toBodySnapshot(state: NetworkObjectState): BodySnapshot {
  return {
    id: { ...state.id },
    position: { ...state.position },
    rotation: { ...state.rotation },
    linearVelocity: { ...state.linearVelocity },
    angularVelocity: { ...state.angularVelocity },
    flags: state.flags,
  };
}

function mixVec3(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
  amount: number,
) {
  return {
    x: mix(a.x, b.x, amount),
    y: mix(a.y, b.y, amount),
    z: mix(a.z, b.z, amount),
  };
}

function mixQuat(
  a: { x: number; y: number; z: number; w: number },
  b: { x: number; y: number; z: number; w: number },
  amount: number,
) {
  const sign = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w < 0 ? -1 : 1;
  const value = {
    x: mix(a.x, b.x * sign, amount),
    y: mix(a.y, b.y * sign, amount),
    z: mix(a.z, b.z * sign, amount),
    w: mix(a.w, b.w * sign, amount),
  };
  const length = Math.hypot(value.x, value.y, value.z, value.w) || 1;
  return {
    x: value.x / length,
    y: value.y / length,
    z: value.z / length,
    w: value.w / length,
  };
}

function quaternion(rotation: BodySnapshot["rotation"]): Quaternion {
  return new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
}

function mix(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function idKey(id: RuntimeId): string {
  return `${id.index}:${id.generation}`;
}
