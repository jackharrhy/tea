import { it } from "remix/test";
import * as assert from "remix/assert";
import { blockReferences } from "./block-references.ts";
it("tracks exact media IDs, including local images in Markdown and nested blocks", () => {
  const refs = blockReferences([
    {
      id: "a",
      type: "markdown",
      props: { body: '<img src="/tea/api/media/file/example%2Did">' },
    },
    {
      id: "b",
      type: "future",
      props: { mediaId: "future-image" },
      children: [
        {
          id: "c",
          type: "media",
          props: { mediaId: "image", adornments: '[{"adornmentName":"Tape"}]' },
        },
      ],
    },
  ]);
  assert.deepEqual([...refs.media], ["example-id", "future-image", "image"]);
  assert.deepEqual([...refs.adornments], ["Tape"]);
  assert.equal(refs.media.has("imag"), false);
});
