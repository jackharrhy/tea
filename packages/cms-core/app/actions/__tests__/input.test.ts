import { it } from "remix/test";
import * as assert from "remix/assert";
import { readInput, validBlocks, validSlug } from "../input.ts";

it("reads bounded editor JSON and rejects oversized input", async () => {
  const valid = new Request("https://cms.example/tea/page", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: '{"title":"Draft"}',
  });
  assert.deepEqual(await readInput(valid), { title: "Draft" });

  const oversized = new Request("https://cms.example/tea/page", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": String(2 * 1024 * 1024 + 1),
    },
    body: "{}",
  });
  assert.equal(await readInput(oversized), null);
});

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
