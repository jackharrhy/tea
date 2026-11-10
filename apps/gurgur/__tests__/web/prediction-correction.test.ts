import { describe, expect, test } from "bun:test";
import { Quaternion } from "three";
import {
  correctedPredictionPose,
  limitPresentationPosition,
  predictionCorrection,
  reconcilePredictionCorrection,
} from "../../web/src/prediction-correction";

const pose = (x: number, yaw = 0) => ({
  position: { x, y: 0, z: 0 },
  rotation: { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) },
});

describe("prediction correction offsets", () => {
  test("unchanged 30 Hz checkpoints preserve physical motion at 60 and 120 Hz", () => {
    for (const frameHz of [60, 120]) {
      let correction = reconcilePredictionCorrection(
        pose(1),
        pose(0),
        null,
        0,
        true,
      );
      const stepMs = 1_000 / frameHz;
      for (let frame = 0; frame <= frameHz / 10; frame += 1) {
        const nowMs = frame * stepMs;
        const physical = pose((24 * nowMs) / 1_000);
        if (frame % (frameHz / 30) === 0)
          correction = reconcilePredictionCorrection(
            physical,
            physical,
            correction,
            nowMs,
            true,
          );
        const rendered = correctedPredictionPose(physical, correction!, nowMs);
        expect(rendered.position.x).toBeCloseTo(
          physical.position.x + Math.max(0, 1 - nowMs / 100),
        );
      }
    }
  });

  test("smooths a centimetre correction instead of snapping it", () => {
    const correction = reconcilePredictionCorrection(
      pose(1),
      pose(0.99),
      null,
      0,
      true,
    )!;
    expect(correctedPredictionPose(pose(0.99), correction, 0).position.x).toBe(
      1,
    );
    expect(
      correctedPredictionPose(pose(0.99), correction, 50).position.x,
    ).toBeCloseTo(0.995);
  });

  test("release applies its offset to the raw host pose before bounding the displayed step", () => {
    const authoritative = pose(0);
    const correction = predictionCorrection(pose(10), authoritative);
    let rendered = limitPresentationPosition(
      correctedPredictionPose(authoritative, correction, 0).position,
      pose(10).position,
    );
    expect(rendered.x).toBe(10);
    rendered = limitPresentationPosition(
      correctedPredictionPose(authoritative, correction, 1_000 / 60).position,
      rendered,
    );
    expect(rendered.x).toBeCloseTo(9.8);
    rendered = limitPresentationPosition(
      correctedPredictionPose(authoritative, correction, 2_000 / 60).position,
      rendered,
    );
    expect(rendered.x).toBeCloseTo(9.6);
  });

  test("unchanged checkpoints do not slow a moving prop or restart a pending correction", () => {
    expect(
      reconcilePredictionCorrection(pose(5), pose(5), null, 0, true),
    ).toBeNull();
    const correction = reconcilePredictionCorrection(
      pose(5),
      pose(4),
      null,
      0,
      true,
    )!;
    expect(correctedPredictionPose(pose(4), correction, 0).position.x).toBe(5);
    const unchanged = reconcilePredictionCorrection(
      pose(6),
      pose(6),
      correction,
      50,
      true,
    )!;
    expect(unchanged).toBe(correction);
    expect(
      correctedPredictionPose(pose(6), unchanged, 50).position.x,
    ).toBeCloseTo(6.5);
    expect(correctedPredictionPose(pose(8), unchanged, 100).position.x).toBe(8);
  });

  test("a second real correction preserves the remaining offset and new physical motion", () => {
    const initial = reconcilePredictionCorrection(
      pose(5),
      pose(4),
      null,
      0,
      true,
    )!;
    const next = reconcilePredictionCorrection(
      pose(6),
      pose(5),
      initial,
      50,
      true,
    )!;
    expect(correctedPredictionPose(pose(5), next, 50).position.x).toBeCloseTo(
      6.5,
    );
    expect(correctedPredictionPose(pose(7), next, 100).position.x).toBeCloseTo(
      7.75,
    );
    expect(correctedPredictionPose(pose(9), next, 150).position.x).toBe(9);
  });

  test("smooths a rotational reconciliation even when the centre did not move", () => {
    const correction = reconcilePredictionCorrection(
      pose(0),
      pose(0, Math.PI / 2),
      null,
      0,
      true,
    )!;
    expect(correction).not.toBeNull();
    const initial = correctedPredictionPose(
      pose(0, Math.PI / 2),
      correction,
      0,
    );
    expect(initial.rotation.y).toBeCloseTo(0);
    const middle = correctedPredictionPose(pose(0, Math.PI), correction, 50);
    const expected = pose(0, (3 * Math.PI) / 4).rotation;
    expect(
      new Quaternion(...Object.values(middle.rotation)).angleTo(
        new Quaternion(...Object.values(expected)),
      ),
    ).toBeCloseTo(0);
    expect(
      correctedPredictionPose(pose(0, Math.PI), correction, 100).rotation.y,
    ).toBeCloseTo(1);
  });

  test("large player corrections snap while a prop retains its visual offset", () => {
    expect(
      reconcilePredictionCorrection(pose(0), pose(2), null, 0, false),
    ).toBeNull();
    const correction = reconcilePredictionCorrection(
      pose(0),
      pose(2),
      null,
      0,
      true,
    )!;
    expect(correctedPredictionPose(pose(2), correction, 0).position.x).toBe(0);
  });
});
