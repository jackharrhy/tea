import type {
  InputCommand,
  ManipulationChangedMessage,
  ManipulationDeniedMessage,
  ManipulationDropMessage,
  ManipulationRequestMessage,
  ManipulationStatePacket,
  NetworkObjectState,
  OwnershipChangedPacket,
  PredictionCheckpointPacket,
  LifecycleMessage,
  RuntimeId,
} from "@harrhy/gurgur-engine";
import type { WorldMessage } from "@harrhy/gurgur-game";

export type PhysicsWorkerRequest =
  | {
      type: "world";
      world: WorldMessage;
      states: NetworkObjectState[];
      localPlayerId: RuntimeId;
      traceEnabled: boolean;
    }
  | { type: "input"; command: InputCommand }
  | { type: "network-states"; states: NetworkObjectState[] }
  | { type: "checkpoint"; message: PredictionCheckpointPacket }
  | { type: "lifecycle"; message: LifecycleMessage }
  | { type: "ownership-changed"; message: OwnershipChangedPacket }
  | { type: "manipulation-changed"; message: ManipulationChangedMessage }
  | { type: "manipulation-denied"; message: ManipulationDeniedMessage }
  | { type: "stall-for-test"; durationMs: number };

export type PhysicsWorkerResponse =
  | { type: "world-ready"; worldEpoch: number }
  | {
      type: "local-states";
      states: NetworkObjectState[];
      collisionStates: NetworkObjectState[];
      /** Fixed-step boundary in the shared performance.timeOrigin + performance.now() clock. */
      producedAtMs: number;
      discardedCatchUpSeconds: number;
      reconciled: boolean;
      inputSequence: number;
      acknowledgment: number | null;
      replayCount: number;
      contactIds: RuntimeId[];
      supportIds: RuntimeId[];
      command: InputCommand | null;
    }
  | { type: "input-command"; command: InputCommand }
  | { type: "manipulation-request"; message: ManipulationRequestMessage }
  | { type: "manipulation-state"; message: ManipulationStatePacket }
  | { type: "manipulation-drop"; message: ManipulationDropMessage }
  | { type: "error"; message: string };

export type OwnershipClient = {
  setWorld(
    world: WorldMessage,
    states: NetworkObjectState[],
    localPlayerId: RuntimeId,
  ): Promise<void>;
  pushInput(command: InputCommand): void;
  pushNetworkStates(states: NetworkObjectState[]): void;
  checkpoint(message: PredictionCheckpointPacket): void;
  applyLifecycle(message: LifecycleMessage): void;
  ownershipChanged(message: OwnershipChangedPacket): void;
  manipulationChanged(message: ManipulationChangedMessage): void;
  manipulationDenied(message: ManipulationDeniedMessage): void;
  stallForTest(durationMs: number): void;
  dispose(): void;
};

export function createOwnershipClient(
  callbacks: {
    localStates(
      frame: Extract<PhysicsWorkerResponse, { type: "local-states" }>,
    ): void;
    inputCommand(command: InputCommand): void;
    manipulationRequest(message: ManipulationRequestMessage): void;
    manipulationState(message: ManipulationStatePacket): void;
    manipulationDrop(message: ManipulationDropMessage): void;
    error(message: string): void;
  },
  options: { traceEnabled?: boolean } = {},
): OwnershipClient {
  const worker = new Worker("/physics-worker.js", {
    type: "module",
    name: "gurgur-owner-physics",
  });
  const ready = new Map<number, Array<() => void>>();

  worker.addEventListener(
    "message",
    (event: MessageEvent<PhysicsWorkerResponse>) => {
      const message = event.data;
      if (message.type === "world-ready") {
        for (const resolve of ready.get(message.worldEpoch) ?? []) resolve();
        ready.delete(message.worldEpoch);
      } else if (message.type === "local-states") {
        callbacks.localStates({
          ...message,
          producedAtMs: message.producedAtMs - performance.timeOrigin,
        });
      } else if (message.type === "input-command") {
        callbacks.inputCommand(message.command);
      } else if (message.type === "manipulation-request") {
        callbacks.manipulationRequest(message.message);
      } else if (message.type === "manipulation-state") {
        callbacks.manipulationState(message.message);
      } else if (message.type === "manipulation-drop") {
        callbacks.manipulationDrop(message.message);
      } else {
        callbacks.error(message.message);
      }
    },
  );
  worker.addEventListener("error", (event) => callbacks.error(event.message));

  const post = (message: PhysicsWorkerRequest): void =>
    worker.postMessage(message, []);
  return {
    setWorld(world, states, localPlayerId) {
      const promise = new Promise<void>((resolve) => {
        const waiters = ready.get(world.worldEpoch) ?? [];
        waiters.push(resolve);
        ready.set(world.worldEpoch, waiters);
      });
      post({
        type: "world",
        world,
        states,
        localPlayerId,
        traceEnabled: options.traceEnabled === true,
      });
      return promise;
    },
    pushInput: (command) => post({ type: "input", command }),
    pushNetworkStates: (states) => post({ type: "network-states", states }),
    checkpoint: (message) => post({ type: "checkpoint", message }),
    applyLifecycle: (message) => post({ type: "lifecycle", message }),
    ownershipChanged: (message) => post({ type: "ownership-changed", message }),
    manipulationChanged: (message) =>
      post({ type: "manipulation-changed", message }),
    manipulationDenied: (message) =>
      post({ type: "manipulation-denied", message }),
    stallForTest: (durationMs) => post({ type: "stall-for-test", durationMs }),
    dispose() {
      worker.terminate();
      for (const waiters of ready.values())
        for (const resolve of waiters) resolve();
      ready.clear();
    },
  };
}
