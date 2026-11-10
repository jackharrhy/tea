import { expect, test } from "bun:test";
import {
  createOwnershipClient,
  type PhysicsWorkerResponse,
} from "../../web/src/ownership-client";

test("worker production timestamps survive delayed delivery on the browser clock", () => {
  const previousWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker")!;
  const workers: EventTarget[] = [];
  class TestWorker extends EventTarget {
    constructor() {
      super();
      workers.push(this);
    }
    terminate() {}
  }
  const timestamps: number[] = [];
  try {
    Object.defineProperty(globalThis, "Worker", {
      configurable: true,
      value: TestWorker,
    });
    const client = createOwnershipClient({
      localStates: ({ producedAtMs }) => timestamps.push(producedAtMs),
      inputCommand() {},
      manipulationRequest() {},
      manipulationState() {},
      manipulationDrop() {},
      error(message) {
        throw new Error(message);
      },
    });
    for (const producedAtMs of [100, 100 + 1_000 / 60, 100 + 1_000 / 60]) {
      const message: PhysicsWorkerResponse = {
        type: "local-states",
        states: [],
        collisionStates: [],
        producedAtMs: performance.timeOrigin + producedAtMs,
        discardedCatchUpSeconds: 0,
        reconciled: timestamps.length === 2,
        inputSequence: 2,
        acknowledgment: 1,
        replayCount: 0,
        contactIds: [],
        supportIds: [],
        command: null,
      };
      workers[0]!.dispatchEvent(new MessageEvent("message", { data: message }));
    }
    expect(timestamps[0]).toBeCloseTo(100, 2);
    expect(timestamps[1]).toBeCloseTo(100 + 1_000 / 60, 2);
    expect(timestamps[2]).toBe(timestamps[1]);
    client.dispose();
  } finally {
    Object.defineProperty(globalThis, "Worker", previousWorker);
  }
});
