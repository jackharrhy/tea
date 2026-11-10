import { describe, expect, test } from "bun:test";
import { compileWorld } from "@tea/gurgur-game";

const fixturePath = "content/maps/fixtures/physics-contraptions.map";

describe("physics contraptions fixture", () => {
  test("compiles the complete executable contraption catalogue deterministically", async () => {
    const source = await Bun.file(fixturePath).text();
    const first = compileWorld(source, fixturePath);
    const second = compileWorld(source, fixturePath);
    expect(first.mapRevision).toBe(second.mapRevision);
    expect(first.brushes).toHaveLength(17);
    expect(
      first.entities
        .filter((entity) => entity.kind === "physics-joint")
        .map((entity) => entity.joint.kind),
    ).toEqual([
      "revolute",
      "revolute",
      "prismatic",
      "spherical",
      "distance",
      "distance",
      "weld",
      "revolute",
    ]);
    expect(
      first.entities
        .filter(
          (entity) =>
            entity.kind === "physics-prop" &&
            entity.authoredId !== "fixture.trebuchet.projectile",
        )
        .every(
          (entity) =>
            entity.interaction === "manipulate" &&
            entity.body.brushIndices.length >= 1,
        ),
    ).toBe(true);
    expect(
      first.entities
        .filter((entity) => entity.kind === "physics-joint")
        .every((entity) => entity.presentation.kind === "constraint"),
    ).toBe(true);
    expect(
      first.entities.find((entity) => entity.kind === "surface-motor")?.body
        .brushIndices,
    ).toHaveLength(2);
    expect(
      first.entities.find((entity) => entity.kind === "gravity-field")?.body
        .brushIndices,
    ).toHaveLength(2);
  });

  test("ships rotatable targets and typed motor choices in the generated FGD", async () => {
    const fgd = await Bun.file("content/trenchbroom/Gurgur.fgd").text();
    for (const classname of [
      "phys_hinge",
      "phys_motor",
      "phys_slideconstraint",
      "phys_ballsocket",
      "phys_lengthconstraint",
      "phys_spring",
      "phys_constraint",
      "func_conveyor",
      "trigger_gravity",
    ])
      expect(fgd).toContain(`= ${classname} :`);
    expect(fgd).toContain('angles(angle) : "Source-style pitch yaw roll"');
    expect(fgd).toContain("motorMode(choices)");
    expect(fgd).toContain('"target-angle" : "Target angle"');
    expect(fgd).toContain("attach1(target_destination)");
    expect(fgd).toContain('renderable(choices) : "Render');
  });
});
