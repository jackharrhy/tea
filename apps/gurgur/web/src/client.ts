import { WorldRenderer } from "./renderer";
import { GameSession } from "./session";
import { createPlayerInput } from "./input";
import { createOwnershipClient } from "./ownership-client";
import { WorldAudio } from "./audio";
import {
  NETWORK_FLAG_HELD,
  PROTOCOL_VERSION,
  cloneNetworkState,
  isStaleNetworkState,
} from "@tea/gurgur-engine";
import type {
  InputCommand,
  NetworkObjectState,
  PhysicsDebugFrame,
  RuntimeId,
  UseRequestMessage,
} from "@tea/gurgur-engine";
import type { WorldMessage } from "@tea/gurgur-game";
import { parseDevFollowCamera, type DevFollowCamera } from "./dev-follow";
import { installSpeechChat, type SpeechChat } from "./speech-chat";
import { SpeechSynthesizer } from "./speech-synthesis";
import {
  PredictionTraceRecorder,
  type PredictionTraceFrame,
  type PredictionTracePose,
} from "./prediction-trace";
import {
  DEBUG_PHYSICS_CAPTURE_SECONDS,
  DebugPhysicsCaptureAssembler,
  downloadDebugPhysicsCaptureBlob,
  type DebugPhysicsCaptureDownload,
  type ServerPhysicsCaptureStart,
} from "./debug-capture";

const pose = (state: NetworkObjectState | null): PredictionTracePose | null =>
  state
    ? {
        position: { ...state.position },
        rotation: { ...state.rotation },
        linearVelocity: { ...state.linearVelocity },
        angularVelocity: { ...state.angularVelocity },
        sourceTick: state.sourceTick,
        stateSequence: state.stateSequence,
        flags: state.flags,
      }
    : null;
const renderedPose = (
  state: Pick<PredictionTracePose, "position" | "rotation"> | null,
): PredictionTracePose | null =>
  state
    ? {
        position: { ...state.position },
        rotation: { ...state.rotation },
        linearVelocity: null,
        angularVelocity: null,
        sourceTick: null,
        stateSequence: null,
        flags: null,
      }
    : null;

function finiteDatasetNumber(value: string | undefined): number | null {
  const parsed = Number(value);
  return value !== undefined && Number.isFinite(parsed) ? parsed : null;
}

function finiteSearchNumber(
  parameters: URLSearchParams,
  name: string,
  fallback: number,
): number {
  const value = parameters.get(name);
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function mountGurgur(
  root: HTMLElement,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
  const canvas = root.querySelector<HTMLCanvasElement>("#world");
  if (!canvas) throw new Error("game canvas is missing");
  root.dataset.playerViewReady = "false";
  const searchParams = new URLSearchParams(location.search);
  const debugEnabled =
    searchParams.has("debug") && searchParams.get("debug") !== "0";
  const testEnabled =
    searchParams.has("test") && searchParams.get("test") !== "0";
  const requestedFollowCamera = parseDevFollowCamera(searchParams);
  let followCamera: DevFollowCamera | null = null;
  if (searchParams.has("follow")) {
    root.dataset.followCamera = requestedFollowCamera ? "checking" : "invalid";
    if (requestedFollowCamera) {
      try {
        const response = await fetch("/debug/client-capabilities", {
          cache: "no-store",
          signal,
        });
        const clientCapabilities = response.ok
          ? ((await response.json()) as unknown)
          : null;
        const clientFollowEnabled =
          clientCapabilities !== null &&
          typeof clientCapabilities === "object" &&
          !Array.isArray(clientCapabilities) &&
          (clientCapabilities as { followCamera?: unknown }).followCamera ===
            true;
        if (clientFollowEnabled) {
          followCamera = requestedFollowCamera;
          root.dataset.followCamera = "waiting";
          root.dataset.followTarget = `${followCamera.target.index}:${followCamera.target.generation}`;
          root.dataset.followYaw = String(followCamera.yaw);
          root.dataset.followPitch = String(followCamera.pitch);
        } else {
          root.dataset.followCamera = "unavailable";
        }
      } catch {
        root.dataset.followCamera = "unavailable";
      }
    }
  }

  const textureManifestResponse = await fetch("/assets.json", {
    cache: "no-cache",
    signal,
  });
  if (!textureManifestResponse.ok)
    throw new Error("authored material texture manifest is unavailable");
  const textureManifest = (await textureManifestResponse.json()) as unknown;
  if (signal.aborted) return;
  if (
    !textureManifest ||
    typeof textureManifest !== "object" ||
    Array.isArray(textureManifest)
  ) {
    throw new Error("authored material texture manifest is invalid");
  }
  const assetManifest = textureManifest as Record<string, unknown>;
  if (
    !assetManifest.materials ||
    typeof assetManifest.materials !== "object" ||
    Array.isArray(assetManifest.materials) ||
    !assetManifest.sprites ||
    typeof assetManifest.sprites !== "object" ||
    Array.isArray(assetManifest.sprites) ||
    !assetManifest.audio ||
    typeof assetManifest.audio !== "object" ||
    Array.isArray(assetManifest.audio)
  )
    throw new Error("authored asset manifest is invalid");
  const materialTextureUrls = Object.fromEntries(
    Object.entries(assetManifest.materials).map(([name, value]) => {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        typeof (value as { url?: unknown }).url !== "string" ||
        !(value as { url: string }).url.startsWith("/textures/") ||
        !Number.isSafeInteger((value as { width?: unknown }).width) ||
        (value as { width: number }).width <= 0 ||
        !Number.isSafeInteger((value as { height?: unknown }).height) ||
        (value as { height: number }).height <= 0 ||
        !["retro", "reality"].includes(
          (value as { renderMode?: string }).renderMode ?? "",
        )
      )
        throw new Error(
          `authored material texture metadata is invalid: ${name}`,
        );
      return [
        name,
        {
          url: (value as { url: string }).url,
          width: (value as { width: number }).width,
          height: (value as { height: number }).height,
          renderMode: (value as { renderMode: "retro" | "reality" }).renderMode,
        },
      ];
    }),
  );
  const spriteAssetUrls = Object.fromEntries(
    Object.entries(assetManifest.sprites).map(([name, url]) => {
      if (typeof url !== "string" || !url.startsWith("/sprites/"))
        throw new Error(`authored sprite URL is invalid: ${name}`);
      return [name, url];
    }),
  );
  const audioAssetUrls = Object.fromEntries(
    Object.entries(assetManifest.audio).map(([name, url]) => {
      if (typeof url !== "string" || !url.startsWith("/audio/"))
        throw new Error(`authored audio URL is invalid: ${name}`);
      return [name, url];
    }),
  );
  const speechAssets = assetManifest.speech;
  if (
    !speechAssets ||
    typeof speechAssets !== "object" ||
    Array.isArray(speechAssets) ||
    typeof (speechAssets as { workerUrl?: unknown }).workerUrl !== "string" ||
    !(speechAssets as { workerUrl: string }).workerUrl.startsWith(
      "/speech-worker.js",
    ) ||
    typeof (speechAssets as { scriptUrl?: unknown }).scriptUrl !== "string" ||
    !(speechAssets as { scriptUrl: string }).scriptUrl.startsWith(
      "/lintalker.js?v=",
    ) ||
    typeof (speechAssets as { wasmUrl?: unknown }).wasmUrl !== "string" ||
    !(speechAssets as { wasmUrl: string }).wasmUrl.startsWith(
      "/lintalker.wasm?v=",
    )
  ) {
    throw new Error("speech asset metadata is invalid");
  }
  const speechAssetUrls = speechAssets as {
    workerUrl: string;
    scriptUrl: string;
    wasmUrl: string;
  };
  const worldAudio = new WorldAudio(audioAssetUrls, (state) => {
    root.dataset.audioState = state.state;
    root.dataset.audioAsset = state.asset ?? "";
  });
  let localPlayerId: RuntimeId | null = null;
  let currentWorld: WorldMessage | null = null;
  let workerDiscardedCatchUpSeconds = 0;
  const predictionTrace = new PredictionTraceRecorder();
  const authoritativeStates = new Map<string, NetworkObjectState>();
  const debugCaptureAssembler = debugEnabled
    ? new DebugPhysicsCaptureAssembler()
    : null;
  let activeDebugPhysicsCaptureId: string | null = null;
  let lastDebugPhysicsCapture: DebugPhysicsCaptureDownload | null = null;

  const diagnosticBodies = new Map<
    string,
    {
      entityIndex: number;
      localTop: number;
      networked?: {
        position: { x: number; y: number; z: number };
        rotation: { x: number; y: number; z: number; w: number };
      };
      rendered?: {
        position: { x: number; y: number; z: number };
        rotation: { x: number; y: number; z: number; w: number };
      };
    }
  >();
  const presentedStates = new Map<
    string,
    Pick<PredictionTracePose, "position" | "rotation">
  >();
  const observedStates = new Map<
    string,
    {
      count: number;
      stateSequence: number;
      receivedAtMs: number;
      position: { x: number; y: number; z: number };
    }
  >();
  if (testEnabled) {
    Object.defineProperty(window, "__gurgurDiagnostics", {
      configurable: true,
      writable: false,
      value: Object.freeze({
        bodies: () =>
          [...diagnosticBodies.entries()].map(([runtimeId, body]) => ({
            runtimeId,
            ...structuredClone(body),
          })),
        camera: () => renderer.cameraDiagnostics(),
        clientFeel: () => renderer.clientFeelDiagnostics(),
        speech: () => renderer.speechDiagnostics(),
        presentation: () =>
          [...presentedStates.entries()].map(([runtimeId, state]) => ({
            runtimeId,
            ...structuredClone(state),
          })),
        network: () => ({
          worldEpoch: currentWorld?.worldEpoch ?? null,
          localPlayerId: localPlayerId ? { ...localPlayerId } : null,
          entities: structuredClone(currentWorld?.runtimeEntities ?? []),
        }),
        replication: () =>
          [...observedStates.entries()].map(([runtimeId, value]) => ({
            runtimeId,
            ...structuredClone(value),
          })),
        physics: () => ({
          discardedCatchUpSeconds: workerDiscardedCatchUpSeconds,
        }),
        predictionTrace: () => predictionTrace.frames(),
        lastPhysicsCapture: () =>
          lastDebugPhysicsCapture
            ? {
                filename: lastDebugPhysicsCapture.filename,
                clientFrameCount: lastDebugPhysicsCapture.clientFrameCount,
                serverFrameCount: lastDebugPhysicsCapture.serverFrameCount,
                capturedAt: structuredClone(lastDebugPhysicsCapture.capturedAt),
                bytes: lastDebugPhysicsCapture.blob.size,
              }
            : null,
        stallPhysicsWorker: (durationMs: number) =>
          owner.stallForTest(durationMs),
      }),
    });
  }
  const renderer = new WorldRenderer(
    canvas,
    (body) => {
      root.dataset.localPresentedAt = String(performance.now());
      root.dataset.renderedX = String(body.position.x);
      root.dataset.renderedY = String(body.position.y);
      root.dataset.renderedZ = String(body.position.z);
      if (!followCamera) root.dataset.playerViewReady = "true";
    },
    (body) => {
      if (!testEnabled && !debugEnabled) return;
      presentedStates.set(`${body.id.index}:${body.id.generation}`, {
        position: { ...body.position },
        rotation: { ...body.rotation },
      });
      if (!testEnabled) return;
      const diagnostic = diagnosticBodies.get(
        `${body.id.index}:${body.id.generation}`,
      );
      if (diagnostic)
        diagnostic.rendered = {
          position: { ...body.position },
          rotation: { ...body.rotation },
        };
    },
    materialTextureUrls,
    spriteAssetUrls,
    debugEnabled,
  );
  const speechSynthesizer = new SpeechSynthesizer({
    ...speechAssetUrls,
    onSpeech(speech) {
      root.dataset.lastSpeechSampleCount = String(speech.samples.length);
      root.dataset.lastSpeechPlayed = String(
        renderer.playSpeech(
          speech.speakerId,
          speech.sampleRate,
          speech.samples,
        ),
      );
    },
  });
  if (followCamera) {
    renderer.setViewAngles(followCamera.yaw, followCamera.pitch);
    renderer.setFollowCamera(followCamera.target, (body) => {
      root.dataset.followX = String(body.position.x);
      root.dataset.followY = String(body.position.y);
      root.dataset.followZ = String(body.position.z);
      root.dataset.followCamera = "ready";
      root.dataset.playerViewReady = "true";
    });
  }
  let localPlayerKey: string | null = null;
  let session: GameSession;
  let speechChat: SpeechChat | null = null;
  let loadedWorldEpoch: number | null = null;
  let stateTransportReady = false;
  let ownerPhysicsReady = false;
  let ownerWorldGeneration = 0;
  let lastUseCounter = 0;
  let nextUseRequestId = 1;
  let inputMoving = false;
  let predictedBodyKeys = new Set<string>();
  const enableInputIfReady = (): void => {
    if (stateTransportReady && ownerPhysicsReady && loadedWorldEpoch !== null) {
      input.setWorld(loadedWorldEpoch);
      root.dataset.inputReady = "true";
    } else {
      root.dataset.inputReady = "false";
    }
  };
  const updateObservedStates = (
    states: readonly NetworkObjectState[],
  ): void => {
    for (const state of states) {
      const identity = `${state.id.index}:${state.id.generation}`;
      const observed = observedStates.get(identity);
      observedStates.set(identity, {
        count: (observed?.count ?? 0) + 1,
        stateSequence: state.stateSequence,
        receivedAtMs: performance.now(),
        position: { ...state.position },
      });
      if (identity === localPlayerKey) {
        root.dataset.playerReady = "true";
        root.dataset.playerX = String(state.position.x);
        root.dataset.playerY = String(state.position.y);
        root.dataset.playerZ = String(state.position.z);
        worldAudio.update(state.position);
      }
      if (!testEnabled) continue;
      const diagnostic = diagnosticBodies.get(identity);
      if (diagnostic)
        diagnostic.networked = {
          position: { ...state.position },
          rotation: { ...state.rotation },
        };
    }
  };
  const rememberAuthoritative = (
    states: readonly NetworkObjectState[],
  ): void => {
    for (const state of states) {
      const identity = `${state.id.index}:${state.id.generation}`;
      const previous = authoritativeStates.get(identity);
      if (previous && isStaleNetworkState(state, previous)) continue;
      authoritativeStates.set(identity, cloneNetworkState(state));
    }
  };
  const owner = createOwnershipClient(
    {
      localStates(trace) {
        const { states, producedAtMs, discardedCatchUpSeconds, reconciled } =
          trace;
        workerDiscardedCatchUpSeconds = discardedCatchUpSeconds;
        root.dataset.workerDiscardedCatchUpSeconds = String(
          discardedCatchUpSeconds,
        );
        root.dataset.ownerStateAt = String(performance.now());
        const nextPredictedBodyKeys = new Set(
          states
            .filter((state) => state.kind === "body")
            .map((state) => `${state.id.index}:${state.id.generation}`),
        );
        for (const identity of predictedBodyKeys) {
          if (nextPredictedBodyKeys.has(identity)) continue;
          const authoritative = authoritativeStates.get(identity);
          if (authoritative)
            renderer.releaseLocalState(authoritative, producedAtMs);
        }
        predictedBodyKeys = nextPredictedBodyKeys;
        renderer.applyLocalStates(states, producedAtMs, reconciled);
        renderer.setPredictionInteractions([
          ...trace.contactIds,
          ...trace.supportIds,
        ]);
        const predictedBody =
          states.find(
            (state) =>
              state.kind === "body" && (state.flags & NETWORK_FLAG_HELD) !== 0,
          ) ?? null;
        updateObservedStates(states);
        const predictedPlayer =
          states.find((state) => state.kind === "player") ?? null;
        if (predictedPlayer && (debugEnabled || testEnabled)) {
          const predictedById = new Map(
            states.map((state) => [
              `${state.id.index}:${state.id.generation}`,
              state,
            ]),
          );
          const collisionById = new Map(
            trace.collisionStates.map((state) => [
              `${state.id.index}:${state.id.generation}`,
              state,
            ]),
          );
          const timelines = (id: RuntimeId) => {
            const identity = `${id.index}:${id.generation}`;
            return {
              authoritative: pose(authoritativeStates.get(identity) ?? null),
              collision: pose(collisionById.get(identity) ?? null),
              predicted: pose(predictedById.get(identity) ?? null),
              rendered: renderedPose(presentedStates.get(identity) ?? null),
            };
          };
          const frame: PredictionTraceFrame = {
            atMs: producedAtMs,
            worldEpoch: currentWorld?.worldEpoch ?? 0,
            inputSequence: trace.inputSequence,
            serverTick: predictedPlayer.sourceTick,
            acknowledgment: trace.acknowledgment,
            replayCount: trace.replayCount,
            reconciled,
            command: trace.command ? structuredClone(trace.command) : null,
            contactIds: trace.contactIds,
            supportIds: trace.supportIds,
            player: timelines(predictedPlayer.id),
            held: predictedBody ? timelines(predictedBody.id) : null,
            relevant: trace.collisionStates.map((collision) => ({
              id: { ...collision.id },
              kind: collision.kind,
              timelines: timelines(collision.id),
            })),
          };
          if (activeDebugPhysicsCaptureId && debugCaptureAssembler)
            debugCaptureAssembler.record(activeDebugPhysicsCaptureId, frame);
          else predictionTrace.record(frame);
        }
      },
      inputCommand(command) {
        const sent = session.sendInput(command);
        if (testEnabled) {
          root.dataset.predictedInputSequence = String(command.sequence);
          root.dataset.predictedInputSent = String(sent);
        }
      },
      manipulationRequest(message) {
        session.requestManipulation(message);
      },
      manipulationState(message) {
        const sent = session.sendManipulationState(message);
        if (testEnabled) {
          root.dataset.manipulationStateAt = String(performance.now());
          root.dataset.manipulationStateCount = String(
            Number(root.dataset.manipulationStateCount ?? 0) + 1,
          );
          root.dataset.manipulationStateSent = String(sent);
          root.dataset.manipulationState = JSON.stringify(message);
          root.dataset.speculativeManipulation = "false";
        }
      },
      manipulationDrop(message) {
        session.dropManipulation(message);
      },
      error(message) {
        root.dataset.ownerPhysics = "error";
        root.dataset.ownerPhysicsError = message;
        console.error(`owner physics: ${message}`);
      },
    },
    { traceEnabled: debugEnabled || testEnabled },
  );
  const sendUseOnEdge = (command: InputCommand): void => {
    if (command.interactCounter === lastUseCounter) return;
    lastUseCounter = command.interactCounter;
    if (!command.interactTarget) return;
    const message: UseRequestMessage = {
      type: "use-request",
      protocolVersion: PROTOCOL_VERSION,
      worldEpoch: command.worldEpoch,
      requestId: nextUseRequestId++,
      target: { ...command.interactTarget },
    };
    session.use(message);
  };
  const input = createPlayerInput(
    canvas,
    (command) => {
      root.dataset.inputAt = String(performance.now());
      const moving = Math.hypot(command.moveX, command.moveZ) > 1e-4;
      if (moving && !inputMoving)
        root.dataset.inputMovementStartedAt = String(performance.now());
      inputMoving = moving;
      root.dataset.inputMoveX = String(command.moveX);
      root.dataset.inputMoveZ = String(command.moveZ);
      root.dataset.inputJumpCounter = String(command.jumpCounter);
      root.dataset.inputButtons = String(command.buttons);
      root.dataset.inputSequence = String(command.sequence);
      owner.pushInput(command);
      sendUseOnEdge(command);
    },
    (yaw, pitch) => {
      if (testEnabled) root.dataset.lookAt = String(performance.now());
      if (!followCamera) renderer.setViewAngles(yaw, pitch);
    },
    () => {
      const target = renderer.interactionTarget();
      root.dataset.interactionTarget = target
        ? `${target.index}:${target.generation}`
        : "";
      root.dataset.interactionOutline = renderer.interactionOutlineState();
      return target;
    },
  );
  session = new GameSession(
    {
      status(status, close) {
        root.dataset.connection = status;
        root.dataset.ready = status === "connected" ? "true" : "false";
        speechChat?.setEnabled(status === "connected");
        if (close) {
          root.dataset.closeCode = String(close.code);
          root.dataset.closeReason = close.reason;
        } else {
          delete root.dataset.closeCode;
          delete root.dataset.closeReason;
        }
      },
      welcome(message) {
        localPlayerId = { ...message.playerId };
        localPlayerKey = `${message.playerId.index}:${message.playerId.generation}`;
        renderer.setLocalPlayer(message.playerId);
      },
      world(message) {
        root.dataset.playerViewReady = "false";
        speechSynthesizer.reset();
        renderer.setWorld(message);
        worldAudio.setWorld(message.bundle);
        currentWorld = message;
        loadedWorldEpoch = message.worldEpoch;
        ownerPhysicsReady = false;
        ownerWorldGeneration += 1;
        enableInputIfReady();
        diagnosticBodies.clear();
        presentedStates.clear();
        observedStates.clear();
        authoritativeStates.clear();
        predictedBodyKeys.clear();
        predictionTrace.reset();
        if (testEnabled)
          for (const runtime of message.runtimeEntities) {
            if (runtime.kind !== "world-entity") continue;
            const entity = message.bundle.entities[runtime.entityIndex];
            const brush = entity?.body
              ? message.bundle.brushes[entity.body.brushIndices[0]!]
              : undefined;
            if (!brush) continue;
            diagnosticBodies.set(
              `${runtime.id.index}:${runtime.id.generation}`,
              {
                entityIndex: runtime.entityIndex,
                localTop: Math.max(
                  ...brush.localVertices.map((vertex) => vertex.y),
                ),
              },
            );
          }
        root.dataset.worldReady = "true";
      },
      lifecycle(message) {
        renderer.applyLifecycle(message);
        owner.applyLifecycle(message);
        for (const id of message.removed)
          predictedBodyKeys.delete(`${id.index}:${id.generation}`);
        if (currentWorld?.worldEpoch === message.worldEpoch) {
          const removed = new Set(
            message.removed.map((id) => `${id.index}:${id.generation}`),
          );
          currentWorld.runtimeEntities = [
            ...currentWorld.runtimeEntities.filter(
              (entity) =>
                !removed.has(`${entity.id.index}:${entity.id.generation}`),
            ),
            ...message.created,
          ];
        }
      },
      bootstrap(states, receivedAtMs) {
        rememberAuthoritative(states);
        renderer.applyBootstrap(states, receivedAtMs);
        updateObservedStates(states);
        const world = currentWorld;
        const playerId = localPlayerId;
        if (!world || !playerId || world.worldEpoch !== loadedWorldEpoch)
          return;
        const generation = ++ownerWorldGeneration;
        root.dataset.ownerPhysics = "loading";
        void owner.setWorld(world, states, playerId).then(() => {
          if (
            generation !== ownerWorldGeneration ||
            currentWorld?.worldEpoch !== world.worldEpoch
          )
            return;
          ownerPhysicsReady = true;
          root.dataset.ownerPhysics = "ready";
          enableInputIfReady();
        });
      },
      state(states, receivedAtMs) {
        rememberAuthoritative(states);
        renderer.applyNetworkStates(
          states.filter(
            (state) =>
              `${state.id.index}:${state.id.generation}` !== localPlayerKey,
          ),
          receivedAtMs,
        );
        owner.pushNetworkStates(states);
        updateObservedStates(states);
        root.dataset.worldEpoch = String(loadedWorldEpoch ?? "");
      },
      checkpoint(message) {
        rememberAuthoritative([
          message.player,
          ...message.nearbyBodies,
          ...(message.held ? [message.held.body] : []),
        ]);
        owner.checkpoint(message);
        root.dataset.lastAcknowledgedInputSequence = String(
          message.lastProcessedInputSequence ?? -1,
        );
        root.dataset.predictionCheckpointTick = String(message.serverTick);
      },
      ownership(message, receivedAtMs) {
        const descriptor = currentWorld?.runtimeEntities.find(
          (entity) =>
            entity.id.index === message.id.index &&
            entity.id.generation === message.id.generation,
        );
        if (descriptor) {
          descriptor.ownerPlayerId = message.ownerPlayerId
            ? { ...message.ownerPlayerId }
            : null;
          descriptor.authorityVersion = message.authorityVersion;
        }
        const local =
          localPlayerId !== null &&
          message.id.index === localPlayerId.index &&
          message.id.generation === localPlayerId.generation;
        renderer.applyOwnershipState(message.state, local, receivedAtMs);
        owner.ownershipChanged(message);
        updateObservedStates([message.state]);
      },
      manipulation(message) {
        const local =
          localPlayerId !== null &&
          message.manipulatorPlayerId !== null &&
          message.manipulatorPlayerId.index === localPlayerId.index &&
          message.manipulatorPlayerId.generation === localPlayerId.generation;
        renderer.applyManipulationState(message.target, local);
        owner.manipulationChanged(message);
        root.dataset.manipulationTarget = local
          ? `${message.target.index}:${message.target.generation}`
          : "";
      },
      manipulationDenied(message) {
        owner.manipulationDenied(message);
      },
      clock(serverTick, receivedAtMs, oneWayDelayMs) {
        root.dataset.serverTick = String(serverTick);
        renderer.updateClock(serverTick, receivedAtMs, oneWayDelayMs);
      },
      network(rttMs, jitterMs) {
        root.dataset.rttMs = rttMs.toFixed(1);
        root.dataset.jitterMs = jitterMs.toFixed(1);
      },
      transport(state) {
        root.dataset.transport = state;
        stateTransportReady = state === "webrtc";
        enableInputIfReady();
      },
      speech(message) {
        root.dataset.lastSpeechText = message.text;
        root.dataset.lastSpeechSpeaker = `${message.speakerId.index}:${message.speakerId.generation}`;
        speechSynthesizer.enqueue(message);
      },
      speechRejected(message) {
        speechChat?.rejected(
          message.retryAfterMs,
          message.reason === "world-changed",
        );
      },
    },
    {
      simulatedLatencyMs: Number(searchParams.get("simulatedLatencyMs") ?? 0),
      simulatedJitterMs: Number(searchParams.get("simulatedJitterMs") ?? 0),
      simulatedLossRate: Number(searchParams.get("simulatedLossRate") ?? 0),
      simulatedSeed: Number(searchParams.get("simulatedSeed") ?? 0x67757267),
    },
  );
  const speechForm = root.querySelector<HTMLFormElement>("#speech-chat");
  const speechField = root.querySelector<HTMLInputElement>("#speech-text");
  const speechStatus = root.querySelector<HTMLOutputElement>("#speech-status");
  if (!speechForm || !speechField || !speechStatus)
    throw new Error("speech chat UI is missing");
  speechChat = installSpeechChat({
    form: speechForm,
    field: speechField,
    status: speechStatus,
    input,
    submit: (requestId, text) => session.speak(requestId, text),
  });

  let debugPoll: number | null = null;
  let debugRequest: AbortController | null = null;
  let debugCaptureRequest: AbortController | null = null;
  let debugCaptureActive = false;
  let debugHotkey: ((event: KeyboardEvent) => void) | null = null;
  let debugPanel: HTMLElement | null = null;
  if (debugEnabled) {
    root.dataset.debug = "true";
    const panel = document.createElement("section");
    debugPanel = panel;
    panel.id = "debug-status";
    const physicsStatus = document.createElement("output");
    physicsStatus.textContent = "debug · waiting for host physics";
    const captureStatus = document.createElement("output");
    captureStatus.textContent =
      "physics capture ready · play normally, then press F8";
    const controls = document.createElement("div");
    const recordButton = document.createElement("button");
    recordButton.type = "button";
    recordButton.textContent = "record 15s (F8)";
    const downloadButton = document.createElement("button");
    downloadButton.type = "button";
    downloadButton.textContent = "download last trace";
    downloadButton.hidden = true;
    controls.append(recordButton, downloadButton);
    panel.append(physicsStatus, captureStatus, controls);
    root.append(panel);

    const startPhysicsCapture = async (): Promise<void> => {
      if (debugCaptureActive) return;
      const playerId = localPlayerId;
      const world = currentWorld;
      if (!playerId || !world || root.dataset.inputReady !== "true") {
        captureStatus.textContent =
          "capture unavailable · wait for the game to finish connecting";
        return;
      }
      debugCaptureActive = true;
      recordButton.disabled = true;
      downloadButton.disabled = true;
      root.dataset.debugCapture = "starting";
      predictionTrace.reset();
      const captureId = crypto.randomUUID();
      activeDebugPhysicsCaptureId = captureId;
      debugCaptureAssembler?.start(captureId);
      const startedAtIso = new Date().toISOString();
      const clientStartedAtMs = performance.now();
      debugCaptureRequest = new AbortController();
      let countdown: number | null = null;
      try {
        const response = await fetch(
          `/debug/network-trace?test=1&player=${playerId.index}:${playerId.generation}`,
          {
            method: "POST",
            cache: "no-store",
            signal: debugCaptureRequest.signal,
          },
        );
        if (!response.ok)
          throw new Error(
            `physics capture could not start (${response.status})`,
          );
        const serverStart =
          (await response.json()) as ServerPhysicsCaptureStart;
        if (
          typeof serverStart.id !== "string" ||
          serverStart.durationSeconds !== DEBUG_PHYSICS_CAPTURE_SECONDS
        )
          throw new Error("physics capture returned invalid metadata");

        const updateCountdown = (): void => {
          const remaining = Math.max(
            0,
            DEBUG_PHYSICS_CAPTURE_SECONDS -
              (performance.now() - clientStartedAtMs) / 1_000,
          );
          captureStatus.textContent = `recording server + client physics · ${remaining.toFixed(1)}s remaining`;
          root.dataset.debugCapture = "recording";
        };
        updateCountdown();
        countdown = window.setInterval(updateCountdown, 100);
        const remainingMs = Math.max(
          0,
          DEBUG_PHYSICS_CAPTURE_SECONDS * 1_000 -
            (performance.now() - clientStartedAtMs),
        );
        await new Promise<void>((resolve) =>
          window.setTimeout(resolve, remainingMs),
        );
        if (countdown !== null) clearInterval(countdown);
        countdown = null;
        captureStatus.textContent =
          "recording complete · collecting server timeline";
        root.dataset.debugCapture = "collecting";

        let serverJson: ArrayBuffer | null = null;
        const collectionDeadline = performance.now() + 10_000;
        while (performance.now() < collectionDeadline) {
          const captureResponse = await fetch(
            `/debug/network-trace?test=1&id=${encodeURIComponent(serverStart.id)}`,
            { cache: "no-store", signal: debugCaptureRequest.signal },
          );
          if (captureResponse.status === 202) {
            await new Promise<void>((resolve) =>
              window.setTimeout(resolve, 100),
            );
            continue;
          }
          if (!captureResponse.ok)
            throw new Error(
              `server capture could not be collected (${captureResponse.status})`,
            );
          serverJson = await captureResponse.arrayBuffer();
          break;
        }
        if (!serverJson)
          throw new Error("server capture did not finish in time");

        const completedAtIso = new Date().toISOString();
        const clientCompletedAtMs = performance.now();
        activeDebugPhysicsCaptureId = null;
        if (!debugCaptureAssembler)
          throw new Error("physics capture worker is unavailable");
        lastDebugPhysicsCapture = await debugCaptureAssembler.finish(
          captureId,
          {
            capturedAt: {
              startedAtIso,
              completedAtIso,
              clientPerformanceTimeOriginMs: performance.timeOrigin,
              clientStartedAtMs,
              clientCompletedAtMs,
            },
            context: {
              url: location.href,
              userAgent: navigator.userAgent,
              mapRevision: world.bundle.mapRevision,
              worldEpoch: world.worldEpoch,
              localPlayerId: { ...playerId },
              network: {
                rttMs: finiteDatasetNumber(root.dataset.rttMs),
                jitterMs: finiteDatasetNumber(root.dataset.jitterMs),
                transport: root.dataset.transport ?? null,
                simulatedLatencyMs: finiteSearchNumber(
                  searchParams,
                  "simulatedLatencyMs",
                  0,
                ),
                simulatedJitterMs: finiteSearchNumber(
                  searchParams,
                  "simulatedJitterMs",
                  0,
                ),
                simulatedLossRate: finiteSearchNumber(
                  searchParams,
                  "simulatedLossRate",
                  0,
                ),
                simulatedSeed: finiteSearchNumber(
                  searchParams,
                  "simulatedSeed",
                  0x67757267,
                ),
              },
            },
            client: {
              discardedCatchUpSeconds: workerDiscardedCatchUpSeconds,
              feel: renderer.clientFeelDiagnostics(),
            },
          },
          serverJson,
        );
        const captureSummary = {
          filename: lastDebugPhysicsCapture.filename,
          clientFrameCount: lastDebugPhysicsCapture.clientFrameCount,
          serverFrameCount: lastDebugPhysicsCapture.serverFrameCount,
          capturedAt: lastDebugPhysicsCapture.capturedAt,
          bytes: lastDebugPhysicsCapture.blob.size,
        };
        Object.defineProperty(window, "__gurgurLastPhysicsCapture", {
          configurable: true,
          value: captureSummary,
        });
        downloadDebugPhysicsCaptureBlob(lastDebugPhysicsCapture);
        root.dataset.debugCaptureClientFrames = String(
          lastDebugPhysicsCapture.clientFrameCount,
        );
        root.dataset.debugCaptureServerFrames = String(
          lastDebugPhysicsCapture.serverFrameCount,
        );
        captureStatus.textContent = `capture ready · ${lastDebugPhysicsCapture.clientFrameCount} client / ${lastDebugPhysicsCapture.serverFrameCount} server frames`;
        root.dataset.debugCapture = "complete";
        downloadButton.hidden = false;
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          captureStatus.textContent =
            error instanceof Error
              ? `capture failed · ${error.message}`
              : "capture failed";
          root.dataset.debugCapture = "error";
        }
      } finally {
        if (countdown !== null) clearInterval(countdown);
        if (activeDebugPhysicsCaptureId === captureId) {
          debugCaptureAssembler?.cancel(captureId);
          activeDebugPhysicsCaptureId = null;
        }
        debugCaptureRequest = null;
        debugCaptureActive = false;
        recordButton.disabled = false;
        downloadButton.disabled = false;
      }
    };
    recordButton.addEventListener("click", () => void startPhysicsCapture());
    downloadButton.addEventListener("click", () => {
      if (lastDebugPhysicsCapture)
        downloadDebugPhysicsCaptureBlob(lastDebugPhysicsCapture);
    });
    debugHotkey = (event): void => {
      if (event.code !== "F8" || event.repeat) return;
      event.preventDefault();
      void startPhysicsCapture();
    };
    addEventListener("keydown", debugHotkey);

    const pollPhysics = async (): Promise<void> => {
      if (debugRequest) return;
      debugRequest = new AbortController();
      try {
        const response = await fetch("/debug/physics?test=1", {
          cache: "no-store",
          signal: debugRequest.signal,
        });
        if (!response.ok)
          throw new Error(`physics debug request failed (${response.status})`);
        const frame = (await response.json()) as PhysicsDebugFrame;
        renderer.applyPhysicsDebugFrame(frame);
        root.dataset.physicsDebugPrimitives = String(frame.primitives.length);
        physicsStatus.textContent = `debug · server tick ${frame.serverTick} · ${frame.primitives.length} physics primitives${frame.truncated ? " · truncated" : ""}`;
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          physicsStatus.textContent =
            error instanceof Error
              ? `debug · ${error.message}`
              : "debug · unavailable";
        }
      } finally {
        debugRequest = null;
      }
    };
    void pollPhysics();
    debugPoll = window.setInterval(() => void pollPhysics(), 100);
  }

  renderer.start();
  session.connect();
  const unlockAudio = (): void => {
    void worldAudio.unlock();
    void renderer.unlockSpeechAudio();
  };
  addEventListener("pointerdown", unlockAudio, {
    passive: true,
    capture: true,
  });
  addEventListener("keydown", unlockAudio, { capture: true });
  const dispose = () => {
    if (debugPoll !== null) clearInterval(debugPoll);
    debugRequest?.abort();
    debugCaptureRequest?.abort();
    if (debugHotkey) removeEventListener("keydown", debugHotkey);
    session.close();
    speechChat?.dispose();
    speechSynthesizer.dispose();
    debugCaptureAssembler?.dispose();
    owner.dispose();
    input.dispose();
    removeEventListener("pointerdown", unlockAudio, { capture: true });
    removeEventListener("keydown", unlockAudio, { capture: true });
    worldAudio.dispose();
    renderer.dispose();
    debugPanel?.remove();
    if (testEnabled)
      delete (window as Window & { __gurgurDiagnostics?: unknown })
        .__gurgurDiagnostics;
    delete (window as Window & { __gurgurLastPhysicsCapture?: unknown })
      .__gurgurLastPhysicsCapture;
  };
  signal.addEventListener("abort", dispose, { once: true });
  if (signal.aborted) dispose();
}
