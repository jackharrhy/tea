import { it } from "remix/test";
import * as assert from "remix/assert";
import { validBlocks, validSlug } from "./input.ts";

it("rejects malformed known blocks before they can corrupt a public page", () => {
  assert.equal(
    validBlocks([{ id: "a", type: "paragraph", props: {}, content: [null] }]),
    false,
  );
  assert.equal(
    validBlocks([
      { id: "a", type: "markdown", props: { body: { bad: true } } },
    ]),
    false,
  );
  assert.equal(
    validBlocks([
      {
        id: "a",
        type: "paragraph",
        props: {},
        content: [{ type: "link", href: "javascript:alert(1)", content: [] }],
      },
    ]),
    false,
  );
  assert.equal(
    validBlocks([
      {
        id: "a",
        type: "future-block",
        props: { future: { keep: true } },
        children: [],
      },
    ]),
    true,
  );
  assert.equal(validSlug("nested/page"), false);
  assert.equal(validSlug("tea"), false);
  for (const css of [
    null,
    [],
    { left: "10%;position:fixed" },
    { filter: "url(https://example.test/tracker)" },
    { width: { bad: true } },
  ]) {
    assert.equal(
      validBlocks([
        {
          id: "image",
          type: "media",
          props: {
            adornments: JSON.stringify([{ adornmentName: "tape", css }]),
          },
        },
      ]),
      false,
    );
  }
  assert.equal(
    validBlocks([
      {
        id: "image",
        type: "media",
        props: {
          adornments: JSON.stringify([
            { adornmentName: "tape", css: { left: "10%", rotation: 15 } },
          ]),
        },
      },
    ]),
    true,
  );
});
