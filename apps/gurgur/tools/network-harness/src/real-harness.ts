import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RTCPeerConnection, type RTCDataChannel } from "werift";
import {
  BOOTSTRAP_STATE_TAG,
  LIFECYCLE_TAG,
  OWNERSHIP_CHANGED_TAG,
  PHYSICS_HZ,
  PROTOCOL_VERSION,
  RENDER_INTERPOLATION_MAX_TICKS,
  STATE_CLUSTER_TAG,
  StateReceiver,
  binaryPacketTag,
  decodeBootstrapState,
  decodeLifecycle,
  decodeOwnershipChanged,
  decodeServerControl,
  decodeStateCluster,
  encodeInputBundle,
  encodeStateAck,
  unwrapTick32,
  type InputCommand,
  type NetworkPlayerState,
  type RuntimeId,
  type WelcomeMessage,
  type WorldManifestMessage,
} from "@harrhy/gurgur-engine";
import { PresentationBuffer } from "../../../web/src/presentation";
import { createGurgurServer } from "../../../server/src/server";
import { guardIceUdpSockets } from "../../../server/src/rtc";
import { WORLD_BUNDLE } from "../../../server/src/world";
import { NETWORK_PROFILES } from "./profiles";
import {
  UnreliableDatagramLink,
  type NetworkProfile,
} from "./unreliable-datagram-link";

type ProfileReport = {
  clients: number;
  stateAgeP95Ms: number;
  stateIntervalP95Ms: number;
  targetStateSamples: number;
  presentationPathErrorP95Cm: number;
  presentationPathErrorSamples: number;
  bufferUnderrunPercent: number;
  bufferUnderrunFrames: number;
  advancingFramePercent: number;
  advancingFramePercent60Hz: number;
  advancingFramePercent120Hz: number;
  averageBitsPerSecondPerRecipient: number;
  sentPackets: number;
  droppedPackets: number;
  staleAuthorityAccepted: number;
};

export type HarnessReport = {
  reportVersion: 7;
  clientCount: number;
  propCount: number;
  durationMs: number;
  profiles: Record<string, ProfileReport>;
  server: ReturnType<Awaited<ReturnType<typeof createGurgurServer>>["metrics"]>;
  correctnessErrors: string[];
};

type HarnessClient = {
  index: number;
  profile: NetworkProfile;
  socket: WebSocket;
  peer: RTCPeerConnection;
  input: RTCDataChannel;
  state: RTCDataChannel;
  welcome: WelcomeMessage;
  world: WorldManifestMessage;
  receiver: StateReceiver;
  authorityVersions: Map<string, number>;
  outbound: UnreliableDatagramLink<ArrayBuffer>;
  inbound: UnreliableDatagramLink<ArrayBuffer>;
  player: NetworkPlayerState;
  nextInputMs: number;
  nextInputSequence: number;
  inputHistory: InputCommand[];
  renderTarget: RuntimeId | null;
  pathOracle: PathOracle | null;
  lastTargetStateAtMs: number | null;
  targetStateIntervalsMs: number[];
  renders: Record<60 | 120, RenderMetrics>;
  stateAgesMs: number[];
  staleAuthorityAccepted: number;
  errors: string[];
  startedAt: number;
};

type RenderMetrics = {
  presentation: PresentationBuffer;
  nextMs: number;
  previousZ: number | null;
  previousOracleZ: number | null;
  eligibleFrames: number;
  advancingFrames: number;
  oracleFrames: number;
  underrunFrames: number;
  pathErrorsCm: number[];
};

type PathOracle = {
  anchorTimelineTick: number;
  anchorSentAtMs: number;
  latestTimelineTick: number;
  samples: { timelineTick: number; z: number }[];
};

export async function runRealNetworkHarness(options: {
  clientCount: number;
  propCount: number;
  durationMs: number;
  seed?: number;
}): Promise<HarnessReport> {
  const { clientCount, propCount, durationMs } = options;
  const seed = options.seed ?? 0x67757267;
  if (!Number.isInteger(clientCount) || clientCount < 2 || clientCount > 32)
    throw new Error("clientCount must be between 2 and 32");
  if (!Number.isInteger(propCount) || propCount < 6 || propCount > 512)
    throw new Error("propCount must be between 6 and 512");
  const directory = await mkdtemp(join(tmpdir(), "gurgur-network-v7-"));
  const server = await createGurgurServer({
    port: 0,
    hostname: "127.0.0.1",
    databasePath: join(directory, "world.sqlite"),
    extraDynamicBodies: Math.max(
      0,
      propCount -
        WORLD_BUNDLE.entities.filter((entity) => entity.body !== null).length,
    ),
  });
  const profiles = [
    NETWORK_PROFILES.local,
    NETWORK_PROFILES.typical,
    NETWORK_PROFILES.adverse,
  ];
  const clients: HarnessClient[] = [];
  try {
    clients.push(
      ...(await Promise.all(
        Array.from({ length: clientCount }, (_, index) =>
          connectClient(
            server.port,
            index,
            profiles[index % profiles.length]!,
            seed + index * 17,
          ),
        ),
      )),
    );
    const startedAt = performance.now();
    for (const client of clients) {
      client.startedAt = startedAt;
      client.outbound = new UnreliableDatagramLink(
        client.profile,
        seed + client.index * 2,
      );
      client.inbound = new UnreliableDatagramLink(
        client.profile,
        seed + client.index * 2 + 1,
      );
      client.nextInputMs = 0;
      for (const render of Object.values(client.renders)) render.nextMs = 300;
    }
    while (performance.now() - startedAt < durationMs) {
      const now = performance.now() - startedAt;
      for (const client of clients) {
        publishInput(client, now);
        deliverOutbound(client, now);
        deliverInbound(client, now);
        samplePresentation(client, now);
      }
      await Bun.sleep(2);
    }
    const byProfile = Object.fromEntries(
      profiles.map((profile) => {
        const selected = clients.filter(
          (client) => client.profile.name === profile.name,
        );
        const ages = selected.flatMap((client) => client.stateAgesMs);
        const intervals = selected.flatMap(
          (client) => client.targetStateIntervalsMs,
        );
        const renders = selected.flatMap((client) =>
          Object.values(client.renders),
        );
        const pathErrorsCm = renders.flatMap((render) => render.pathErrorsCm);
        const oracleFrames = renders.reduce(
          (sum, render) => sum + render.oracleFrames,
          0,
        );
        const underrunFrames = renders.reduce(
          (sum, render) => sum + render.underrunFrames,
          0,
        );
        const advancingPercent = (displayHz: 60 | 120): number => {
          const eligible = selected.reduce(
            (sum, client) => sum + client.renders[displayHz].eligibleFrames,
            0,
          );
          const advanced = selected.reduce(
            (sum, client) => sum + client.renders[displayHz].advancingFrames,
            0,
          );
          return eligible ? (advanced / eligible) * 100 : 0;
        };
        const advancingFramePercent60Hz = advancingPercent(60);
        const advancingFramePercent120Hz = advancingPercent(120);
        const sentBytes = selected.reduce(
          (sum, client) => sum + client.inbound.metrics.sentBytes,
          0,
        );
        return [
          profile.name,
          {
            clients: selected.length,
            stateAgeP95Ms: percentile(ages, 0.95),
            stateIntervalP95Ms: percentile(intervals, 0.95),
            targetStateSamples: intervals.length + selected.length,
            presentationPathErrorP95Cm: percentile(pathErrorsCm, 0.95),
            presentationPathErrorSamples: pathErrorsCm.length,
            bufferUnderrunPercent: oracleFrames
              ? (underrunFrames / oracleFrames) * 100
              : 100,
            bufferUnderrunFrames: underrunFrames,
            advancingFramePercent: Math.min(
              advancingFramePercent60Hz,
              advancingFramePercent120Hz,
            ),
            advancingFramePercent60Hz,
            advancingFramePercent120Hz,
            averageBitsPerSecondPerRecipient:
              selected.length === 0
                ? 0
                : (sentBytes * 8 * 1_000) / durationMs / selected.length,
            sentPackets: selected.reduce(
              (sum, client) => sum + client.inbound.metrics.sentPackets,
              0,
            ),
            droppedPackets: selected.reduce(
              (sum, client) => sum + client.inbound.metrics.droppedPackets,
              0,
            ),
            staleAuthorityAccepted: selected.reduce(
              (sum, client) => sum + client.staleAuthorityAccepted,
              0,
            ),
          },
        ];
      }),
    );
    return {
      reportVersion: 7,
      clientCount,
      propCount,
      durationMs,
      profiles: byProfile,
      server: server.metrics(),
      correctnessErrors: clients.flatMap((client) => client.errors),
    };
  } finally {
    await Promise.all(
      clients.map(async (client) => {
        await client.peer.close();
        client.socket.close();
      }),
    );
    server.stop();
    await rm(directory, { recursive: true, force: true });
  }
}

function publishInput(client: HarnessClient, nowMs: number): void {
  while (nowMs >= client.nextInputMs) {
    const command: InputCommand = {
      type: "input",
      protocolVersion: PROTOCOL_VERSION,
      worldEpoch: client.world.worldEpoch,
      sequence: client.nextInputSequence,
      clientTick: client.nextInputSequence,
      moveX: 0,
      moveZ: 1,
      lookYaw: 0,
      lookPitch: 0,
      buttons: 0,
      jumpCounter: 0,
      interactCounter: 0,
      interactTarget: null,
      primaryCounter: 0,
    };
    client.nextInputSequence += 1;
    client.inputHistory.push(command);
    while (client.inputHistory.length > 4) client.inputHistory.shift();
    const packet = encodeInputBundle({
      worldEpoch: client.world.worldEpoch,
      commands: client.inputHistory,
    });
    client.outbound.send(client.nextInputMs, packet.byteLength, packet);
    client.nextInputMs += 1_000 / PHYSICS_HZ;
  }
}

function deliverOutbound(client: HarnessClient, nowMs: number): void {
  for (const packet of client.outbound.advance(nowMs)) {
    if (client.input.readyState === "open")
      client.input.send(Buffer.from(packet.payload));
  }
}

function deliverInbound(client: HarnessClient, nowMs: number): void {
  for (const packet of client.inbound.advance(nowMs)) {
    samplePresentation(client, packet.deliveryAtMs);
    try {
      if (binaryPacketTag(packet.payload) !== STATE_CLUSTER_TAG) continue;
      const received = client.receiver.applyCluster(
        decodeStateCluster(packet.payload),
      );
      for (const state of received.accepted) {
        const currentAuthority = client.authorityVersions.get(idKey(state.id));
        if (
          currentAuthority !== undefined &&
          state.authorityVersion < currentAuthority
        )
          client.staleAuthorityAccepted += 1;
        if (state.kind !== "player" || same(state.id, client.welcome.playerId))
          continue;
        client.stateAgesMs.push(packet.deliveryAtMs - packet.sentAtMs);
        if (!client.renderTarget) {
          client.renderTarget = { ...state.id };
          client.lastTargetStateAtMs = packet.deliveryAtMs;
          client.pathOracle = {
            anchorTimelineTick: state.sourceTick,
            anchorSentAtMs: packet.sentAtMs,
            latestTimelineTick: state.sourceTick,
            samples: [{ timelineTick: state.sourceTick, z: state.position.z }],
          };
          for (const render of Object.values(client.renders))
            render.presentation.updateClock(
              state.sourceTick,
              packet.deliveryAtMs,
              packet.deliveryAtMs - packet.sentAtMs,
            );
        } else if (same(state.id, client.renderTarget)) {
          if (client.pathOracle) {
            const timelineTick = unwrapTick32(
              state.sourceTick,
              client.pathOracle.latestTimelineTick,
            );
            client.pathOracle.latestTimelineTick = timelineTick;
            client.pathOracle.samples.push({
              timelineTick,
              z: state.position.z,
            });
            while (client.pathOracle.samples.length > 256)
              client.pathOracle.samples.shift();
          }
          if (client.lastTargetStateAtMs !== null)
            client.targetStateIntervalsMs.push(
              packet.deliveryAtMs - client.lastTargetStateAtMs,
            );
          client.lastTargetStateAtMs = packet.deliveryAtMs;
        }
        for (const render of Object.values(client.renders))
          render.presentation.pushNetwork([state], packet.deliveryAtMs);
      }
      if (received.ack.entries.length > 0) {
        const ack = encodeStateAck(received.ack);
        client.outbound.send(nowMs, ack.byteLength, ack);
      }
    } catch (error) {
      client.errors.push(
        error instanceof Error ? error.message : "invalid state cluster",
      );
    }
  }
}

function samplePresentation(client: HarnessClient, nowMs: number): void {
  for (const displayHz of [60, 120] as const) {
    const render = client.renders[displayHz];
    while (nowMs > render.nextMs) {
      const target = client.renderTarget;
      if (target) {
        const state = render.presentation
          .sample(render.nextMs)
          .find((candidate) => same(candidate.id, target));
        if (state) {
          const oracle = client.pathOracle;
          if (oracle) {
            render.oracleFrames += 1;
            const delayTicks =
              render.presentation.trackDelayTicks(target) ??
              RENDER_INTERPOLATION_MAX_TICKS;
            const targetTimelineTick =
              oracle.anchorTimelineTick +
              ((render.nextMs - oracle.anchorSentAtMs) / 1_000) * PHYSICS_HZ -
              delayTicks;
            if (targetTimelineTick > oracle.latestTimelineTick + 1e-6) {
              render.underrunFrames += 1;
            } else {
              const expectedZ = sampleOracleZ(
                oracle.samples,
                targetTimelineTick,
              );
              render.pathErrorsCm.push(
                Math.abs(state.position.z - expectedZ) * 100,
              );
              if (
                render.previousOracleZ !== null &&
                Math.abs(expectedZ - render.previousOracleZ) > 1e-5
              ) {
                render.eligibleFrames += 1;
                if (
                  render.previousZ !== null &&
                  Math.abs(state.position.z - render.previousZ) > 1e-5
                )
                  render.advancingFrames += 1;
              }
              render.previousOracleZ = expectedZ;
            }
          }
          render.previousZ = state.position.z;
        }
      }
      render.nextMs += 1_000 / displayHz;
    }
  }
}

function connectClient(
  port: number,
  index: number,
  profile: NetworkProfile,
  seed: number,
): Promise<HarnessClient> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/game`);
    socket.binaryType = "arraybuffer";
    const peer = new RTCPeerConnection({
      iceAdditionalHostAddresses: ["127.0.0.1"],
    });
    const input = peer.createDataChannel("gurgur-input-v7", {
      ordered: false,
      maxRetransmits: 0,
    });
    const receiver = new StateReceiver();
    const authorityVersions = new Map<string, number>();
    let stateChannel: RTCDataChannel | null = null;
    let welcome: WelcomeMessage | null = null;
    let world: WorldManifestMessage | null = null;
    let player: NetworkPlayerState | null = null;
    let inputOpen = false;
    let stateOpen = false;
    let answerStarted = false;
    let client: HarnessClient | null = null;
    const timeout = setTimeout(
      () => reject(new Error("network harness client timed out")),
      10_000,
    );
    const done = (): void => {
      if (
        !stateChannel ||
        !welcome ||
        !world ||
        !player ||
        !inputOpen ||
        !stateOpen
      )
        return;
      clearTimeout(timeout);
      client = {
        index,
        profile,
        socket,
        peer,
        input,
        state: stateChannel,
        welcome,
        world,
        receiver,
        authorityVersions,
        outbound: new UnreliableDatagramLink(profile, seed),
        inbound: new UnreliableDatagramLink(profile, seed + 1),
        player,
        nextInputMs: 0,
        nextInputSequence: 0,
        inputHistory: [],
        renderTarget: null,
        pathOracle: null,
        lastTargetStateAtMs: null,
        targetStateIntervalsMs: [],
        renders: {
          60: {
            presentation: new PresentationBuffer(),
            nextMs: 300,
            previousZ: null,
            previousOracleZ: null,
            eligibleFrames: 0,
            advancingFrames: 0,
            oracleFrames: 0,
            underrunFrames: 0,
            pathErrorsCm: [],
          },
          120: {
            presentation: new PresentationBuffer(),
            nextMs: 300,
            previousZ: null,
            previousOracleZ: null,
            eligibleFrames: 0,
            advancingFrames: 0,
            oracleFrames: 0,
            underrunFrames: 0,
            pathErrorsCm: [],
          },
        },
        stateAgesMs: [],
        staleAuthorityAccepted: 0,
        errors: [],
        startedAt: performance.now(),
      };
      resolve(client);
    };
    input.stateChanged.subscribe((value) => {
      inputOpen = value === "open";
      done();
    });
    peer.onDataChannel.subscribe((channel) => {
      if (channel.label !== "gurgur-state-v7" || stateChannel) {
        channel.close();
        return;
      }
      stateChannel = channel;
      channel.stateChanged.subscribe((value) => {
        stateOpen = value === "open";
        done();
      });
      channel.onMessage.subscribe((packet) => {
        if (!client || typeof packet === "string") return;
        const bytes = Uint8Array.from(packet).buffer;
        const now = Math.max(0, performance.now() - client.startedAt);
        client.inbound.send(now, bytes.byteLength, bytes);
      });
    });
    const acceptOffer = async (description: {
      type: "offer";
      sdp: string;
    }): Promise<void> => {
      if (!welcome || answerStarted) return;
      answerStarted = true;
      try {
        await peer.setRemoteDescription(description);
        await peer.setLocalDescription(await peer.createAnswer());
        guardIceUdpSockets(peer);
        if (!peer.localDescription?.sdp)
          throw new Error("harness RTC answer is missing SDP");
        socket.send(
          JSON.stringify({
            type: "rtc-answer",
            protocolVersion: PROTOCOL_VERSION,
            worldEpoch: welcome.worldEpoch,
            description: { type: "answer", sdp: peer.localDescription.sdp },
          }),
        );
      } catch (error) {
        reject(error);
      }
    };
    socket.addEventListener("open", () =>
      socket.send(
        JSON.stringify({
          type: "hello",
          protocolVersion: PROTOCOL_VERSION,
          mapRevision: null,
          worldEpoch: null,
          sessionToken: null,
          socketGeneration: 0,
        }),
      ),
    );
    socket.addEventListener("message", (event) => {
      if (typeof event.data === "string") {
        const message = decodeServerControl(event.data);
        if (message.type === "welcome") welcome = message;
        else if (message.type === "world") world = message;
        else if (message.type === "rtc-offer")
          void acceptOffer(message.description);
        done();
        return;
      }
      const packet = event.data as ArrayBuffer;
      const tag = binaryPacketTag(packet);
      if (tag === BOOTSTRAP_STATE_TAG) {
        const bootstrap = decodeBootstrapState(packet);
        receiver.reset(bootstrap.states);
        authorityVersions.clear();
        for (const state of bootstrap.states)
          authorityVersions.set(idKey(state.id), state.authorityVersion);
        const state = welcome ? receiver.state(welcome.playerId) : null;
        if (state?.kind === "player") player = state;
      } else if (tag === OWNERSHIP_CHANGED_TAG) {
        const ownership = decodeOwnershipChanged(packet);
        receiver.replaceReliable(ownership.state);
        authorityVersions.set(idKey(ownership.id), ownership.authorityVersion);
        if (
          welcome &&
          same(ownership.id, welcome.playerId) &&
          ownership.state.kind === "player"
        )
          player = ownership.state;
      } else if (tag === LIFECYCLE_TAG) {
        const lifecycle = decodeLifecycle(packet);
        for (const removed of lifecycle.removed) receiver.remove(removed);
      }
      done();
    });
    socket.addEventListener("error", () =>
      reject(new Error("network harness websocket failed")),
    );
  });
}

function percentile(values: readonly number[], amount: number): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor(sorted.length * amount))
  ]!;
}

function sampleOracleZ(
  samples: readonly { timelineTick: number; z: number }[],
  targetTimelineTick: number,
): number {
  const first = samples[0]!;
  if (targetTimelineTick <= first.timelineTick) return first.z;
  const last = samples.at(-1)!;
  if (targetTimelineTick >= last.timelineTick) return last.z;
  const rightIndex = samples.findIndex(
    (sample) => sample.timelineTick >= targetTimelineTick,
  );
  const right = samples[rightIndex]!;
  const left = samples[rightIndex - 1]!;
  const span = right.timelineTick - left.timelineTick;
  if (span <= 0) return right.z;
  const amount = (targetTimelineTick - left.timelineTick) / span;
  return left.z + (right.z - left.z) * amount;
}

function idKey(id: RuntimeId): string {
  return `${id.index}:${id.generation}`;
}

function same(a: RuntimeId, b: RuntimeId): boolean {
  return a.index === b.index && a.generation === b.generation;
}
