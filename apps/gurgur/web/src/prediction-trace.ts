import type { InputCommand, Quat, RuntimeId, Vec3 } from "@tea/gurgur-engine";

export type PredictionTracePose = {
  position: Vec3;
  rotation: Quat;
  linearVelocity: Vec3 | null;
  angularVelocity: Vec3 | null;
  sourceTick: number | null;
  stateSequence: number | null;
  flags: number | null;
};
type PredictionTraceTimelines = {
  authoritative: PredictionTracePose | null;
  collision: PredictionTracePose | null;
  predicted: PredictionTracePose | null;
  rendered: PredictionTracePose | null;
};

export type PredictionTraceFrame = {
  atMs: number;
  worldEpoch: number;
  inputSequence: number;
  serverTick: number;
  acknowledgment: number | null;
  replayCount: number;
  reconciled: boolean;
  command: InputCommand | null;
  contactIds: RuntimeId[];
  supportIds: RuntimeId[];
  player: PredictionTraceTimelines;
  held: PredictionTraceTimelines | null;
  relevant: Array<{
    id: RuntimeId;
    kind: "body" | "player";
    timelines: PredictionTraceTimelines;
  }>;
};

export class PredictionTraceRecorder {
  readonly #capacity: number;
  readonly #frames: PredictionTraceFrame[] = [];

  constructor(capacity = 2_048) {
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new Error("prediction trace capacity must be positive");
    this.#capacity = capacity;
  }

  record(frame: PredictionTraceFrame): void {
    this.#frames.push(structuredClone(frame));
    while (this.#frames.length > this.#capacity) this.#frames.shift();
  }

  frames(): PredictionTraceFrame[] {
    return structuredClone(this.#frames);
  }

  reset(): void {
    this.#frames.length = 0;
  }
}
