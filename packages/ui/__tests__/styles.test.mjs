import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "remix/component";
import { renderToString } from "remix/component/server";
import {
  uiActionStyles,
  uiPrimaryActionStyles,
  uiSecondaryActionStyles,
} from "../styles.ts";
test("standalone primary actions preserve the existing Auth contract", async () => {
  const html = await renderToString(
    createElement("a", { mix: uiPrimaryActionStyles }, "Sign in"),
  );
  for (const rule of [
    "display: inline-flex",
    "align-items: center",
    "justify-content: center",
    "font-weight: 600",
    "text-decoration: none",
    "var(--ui-action-surface)",
  ])
    assert.ok(html.includes(rule), rule);
  assert.ok(!html.includes("min-height:"), "new base geometry stays opt-in");
});
test("new action base supports native link, button and disclosure geometry", async () => {
  for (const tag of ["a", "button", "summary"]) {
    const html = await renderToString(
      createElement(
        tag,
        { mix: [uiActionStyles, uiSecondaryActionStyles] },
        "Action",
      ),
    );
    for (const rule of [
      "min-height: var(--ui-action-min-height, 40px)",
      "padding: var(--ui-action-padding, 9px 14px)",
      "border-radius: var(--ui-control-radius, 5px)",
      "var(--ui-control-hover)",
    ])
      assert.ok(html.includes(rule), rule);
  }
});
