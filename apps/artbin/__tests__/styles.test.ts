import { describe, expect, test } from "vitest";

import { modalOverlayStyle, modalStyle } from "../app/ui/styles.ts";

function properties(descriptor: unknown): Record<string, unknown> {
  return (descriptor as { args: [Record<string, unknown>] }).args[0];
}

describe("Remix UI styles", () => {
  test("keeps dialogs in a centered viewport overlay", () => {
    expect(properties(modalOverlayStyle)).toMatchObject({
      inset: 0,
      position: "fixed",
      zIndex: 1000,
    });
    expect(properties(modalStyle)).toMatchObject({
      maxHeight: "90vh",
      maxWidth: "500px",
      width: "100%",
    });
  });
});
