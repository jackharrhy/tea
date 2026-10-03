import { it } from "remix/test";
import * as assert from "remix/assert";
import { parseAdornmentInstances } from "./adornment-instances.ts";
import { renderBlocks } from "../../../actions/block-renderer.ts";

it("separates repeated artwork into stable instances without changing legacy content", () => {
  const old =
    '[{"adornmentName":"tape"},{"adornmentName":"tape","css":{"left":"70%"}}]';
  const refs = parseAdornmentInstances(old)!;
  assert.deepEqual(
    refs.map((r) => r.id),
    ["legacy:0", "legacy:1"],
  );
  assert.deepEqual(parseAdornmentInstances(JSON.stringify(refs)), refs);
  assert.equal(
    old,
    '[{"adornmentName":"tape"},{"adornmentName":"tape","css":{"left":"70%"}}]',
  );
  assert.equal(
    parseAdornmentInstances(
      '[{"id":"a","adornmentName":"tape"},{"id":"a","adornmentName":"tape"}]',
    ),
    null,
  );
  const html = renderBlocks(
    [
      {
        id: "photo",
        type: "media",
        props: { mediaId: "photo", adornments: old },
      },
    ],
    [{ id: "art", name: "tape", media_id: "tape-file", css: { width: "30%" } }],
  );
  assert.equal((html.match(/class="adornment"/g) ?? []).length, 2);
  assert.ok(html.includes("left:70%"));
});
