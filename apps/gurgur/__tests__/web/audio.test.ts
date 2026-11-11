import { describe, expect, test } from "bun:test";
import {
  compileWorld,
  type AmbientAudioEntity,
  type WorldBundle,
} from "@harrhy/gurgur-game";
import { selectAmbientAudio } from "../../web/src/audio";

const source = await Bun.file(
  new URL("../../content/maps/fixtures/audio-zone.map", import.meta.url),
).text();
const fixture = compileWorld(source, "content/maps/fixtures/audio-zone.map");

describe("per-listener audio zones", () => {
  test("the authored fixture acquires Dylan inside its convex volume and releases outside", () => {
    const trigger = fixture.entities.find(
      (entity) =>
        entity.kind === "trigger" && entity.outputs.enter.input === "play",
    );
    if (!trigger || trigger.kind !== "trigger")
      throw new Error("audio trigger is missing");
    expect(trigger.body.kind).toBe("sensor-brush");
    const brush = fixture.brushes[trigger.body.brushIndices[0]!]!;
    expect(selectAmbientAudio(fixture, brush.center)?.entity.asset).toBe(
      "dylan",
    );
    expect(
      selectAmbientAudio(fixture, {
        x: brush.center.x + 10,
        y: brush.center.y + 10,
        z: brush.center.z + 10,
      }),
    ).toBeNull();
  });

  test("overlapping claims keep one song active and different songs use deterministic priority", () => {
    const trigger = fixture.entities.find(
      (entity) =>
        entity.kind === "trigger" && entity.outputs.enter.input === "play",
    )!;
    if (trigger.kind !== "trigger") throw new Error("audio trigger is missing");
    const brush = fixture.brushes[trigger.body.brushIndices[0]!]!;
    const original = fixture.entities.find(
      (entity): entity is AmbientAudioEntity => entity.kind === "ambient-audio",
    )!;
    const competing: AmbientAudioEntity = {
      ...original,
      asset: "higher-priority",
      priority: original.priority + 1,
    };
    const linkedTrigger = {
      ...trigger,
      outputs: {
        enter: { input: "play" as const, targetEntityIndices: [0, 1] },
        exit: { input: "stop" as const, targetEntityIndices: [0, 1] },
      },
    };
    const bundle: WorldBundle = {
      ...fixture,
      entities: [original, competing, linkedTrigger, { ...linkedTrigger }],
    };
    expect(selectAmbientAudio(bundle, brush.center)?.entity.asset).toBe(
      "higher-priority",
    );
  });
});
