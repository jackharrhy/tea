import { it } from "remix/test";
import * as assert from "remix/assert";
import { createPreviewToken, verifyPreviewToken } from "../preview.ts";

it("binds a short-lived preview to one collection and slug", async () => {
  const now = 1_800_000_000_000;
  const token = await createPreviewToken("news", "first", "local-secret", now);
  assert.equal(
    await verifyPreviewToken(token, "news", "first", "local-secret", now),
    true,
  );
  assert.equal(
    await verifyPreviewToken(token, "news", "second", "local-secret", now),
    false,
  );
  assert.equal(
    await verifyPreviewToken(token, "other", "first", "local-secret", now),
    false,
  );
  assert.equal(
    await verifyPreviewToken(
      token,
      "news",
      "first",
      "local-secret",
      now + 16 * 60_000,
    ),
    false,
  );
});
