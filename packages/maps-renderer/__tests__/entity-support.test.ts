import { describe, expect, it } from "vitest";

import {
  analyzeEntitySupport,
  type BspEntity,
  type ParsedModel,
} from "../src/core/index.js";

const model = (
  entityIndex: number,
  visible: boolean,
  collidable: boolean,
): Pick<ParsedModel, "collidable" | "entityIndex" | "visible"> => ({
  entityIndex,
  visible,
  collidable,
});

describe("entity support reporting", () => {
  it("separates implemented, baked, partial, and skipped entity behavior", () => {
    const entities: BspEntity[] = [
      { classname: "worldspawn" },
      { classname: "light" },
      { classname: "ambient_generic" },
      { classname: "func_wall", model: "*1" },
      { classname: "func_door", model: "*2" },
      { classname: "monster_scientist" },
    ];
    const report = analyzeEntitySupport({
      entities,
      models: [model(3, true, true), model(4, false, false)],
    });

    expect(report.counts).toEqual({
      supported: 2,
      baked: 1,
      partial: 1,
      skipped: 2,
    });
    expect(
      report.classes.find(({ classname }) => classname === "func_door"),
    ).toMatchObject({
      count: 1,
      kind: "skipped",
    });
    expect(
      report.classes.find(({ classname }) => classname === "ambient_generic"),
    ).toMatchObject({
      kind: "partial",
    });
  });

  it("reports the least supported behavior when one classname has mixed model states", () => {
    const entities: BspEntity[] = [
      { classname: "worldspawn" },
      { classname: "func_wall", model: "*1" },
      { classname: "func_wall", model: "*2" },
    ];
    const report = analyzeEntitySupport({
      entities,
      models: [model(1, true, true), model(2, false, false)],
    });

    expect(
      report.classes.find(({ classname }) => classname === "func_wall"),
    ).toMatchObject({
      count: 2,
      kind: "skipped",
    });
  });
});
