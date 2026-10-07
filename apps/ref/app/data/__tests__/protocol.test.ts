import { describe, expect, it } from "vitest";
import { parseOperation } from "../protocol.ts";

const id = "b9e1d673-9bc8-405f-81b1-78be26d171d2";
const assetId = "b6bca822-74b5-4fc9-b24c-180871c64a5a";
const operationId = "c6750c74-8d6d-4eb0-a455-17e708ed1ba7";

describe("board operation validation", () => {
  it("accepts a bounded image placement", () => {
    expect(
      parseOperation({
        kind: "create",
        operationId,
        item: {
          id,
          assetId,
          x: -100,
          y: 25,
          width: 400,
          height: 200,
          rotation: 15,
          z: 1,
        },
      }),
    ).toEqual({
      kind: "create",
      operationId,
      item: {
        id,
        assetId,
        x: -100,
        y: 25,
        width: 400,
        height: 200,
        rotation: 15,
        z: 1,
      },
    });
  });

  it("rejects invalid geometry, revisions, and malformed ids", () => {
    expect(
      parseOperation({
        kind: "create",
        operationId,
        item: {
          id,
          assetId,
          x: 0,
          y: 0,
          width: Infinity,
          height: 200,
          rotation: 0,
          z: 1,
        },
      }),
    ).toBeNull();
    expect(
      parseOperation({
        kind: "transform",
        operationId,
        itemId: id,
        baseRevision: 0,
        x: 0,
        y: 0,
        width: 200,
        height: 200,
        rotation: 0,
        z: 1,
      }),
    ).toBeNull();
    expect(
      parseOperation({
        kind: "remove",
        operationId: "malformed",
        itemId: id,
        baseRevision: 1,
      }),
    ).toBeNull();
  });
});
