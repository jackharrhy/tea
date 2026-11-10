import { describe, expect, test } from "bun:test";
import {
  PredictionTraceRecorder,
  type PredictionTraceFrame,
} from "../../web/src/prediction-trace";

describe("prediction trace recorder", () => {
  test("retains a bounded clone of all four timelines and replay metadata", () => {
    const recorder = new PredictionTraceRecorder(2);
    const frame = sample(1);
    recorder.record(frame);
    frame.player.predicted!.position.x = 999;
    expect(recorder.frames()[0]!.player.predicted!.position.x).toBe(1);
    recorder.record(sample(2));
    recorder.record(sample(3));
    const frames = recorder.frames();
    expect(frames.map((candidate) => candidate.inputSequence)).toEqual([2, 3]);
    expect(frames[0]!.player.authoritative).not.toBeNull();
    expect(frames[0]!.player.collision).not.toBeNull();
    expect(frames[0]!.player.predicted).not.toBeNull();
    expect(frames[0]!.player.rendered).not.toBeNull();
    expect(frames[0]!.acknowledgment).toBe(1);
    expect(frames[0]!.replayCount).toBe(2);
    recorder.reset();
    expect(recorder.frames()).toEqual([]);
  });
});

function sample(sequence: number): PredictionTraceFrame {
  const pose = {
    position: { x: sequence, y: 2, z: 3 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    linearVelocity: { x: 1, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    sourceTick: sequence + 100,
    stateSequence: sequence,
    flags: 0,
  };
  return {
    atMs: sequence * 16,
    worldEpoch: 4,
    inputSequence: sequence,
    serverTick: sequence + 100,
    acknowledgment: sequence - 1,
    replayCount: 2,
    reconciled: true,
    command: null,
    contactIds: [{ index: 7, generation: 1 }],
    supportIds: [{ index: 8, generation: 1 }],
    player: {
      authoritative: pose,
      collision: pose,
      predicted: pose,
      rendered: pose,
    },
    held: null,
    relevant: [],
  };
}
