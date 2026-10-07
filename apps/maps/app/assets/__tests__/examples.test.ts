import { describe, expect, it } from "vitest";
import { parseBsp } from "@tea/maps-renderer/core";
import { examples, exampleSource } from "../examples.ts";

describe("viewer examples", () => {
  it("provides parseable BSPs for each listed example", () => {
    for (const example of examples) {
      const source = exampleSource(example.id);
      expect(source).toBeDefined();
      expect(
        parseBsp(source!.bsp as ArrayBuffer).models.length,
      ).toBeGreaterThan(0);
    }
  });
});
