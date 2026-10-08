import * as assert from "remix/assert";
import { afterEach, beforeEach, describe, it } from "remix/test";

import { routes } from "../../../../routes.ts";
import {
  adminCookie,
  createRouterHarness,
  router,
  type RouterHarness,
} from "../../../../../__tests__/router-harness.ts";

let harness: RouterHarness;

beforeEach(async () => {
  harness = await createRouterHarness();
});

afterEach(() => harness.close());

describe("scan settings mutations", () => {
  it("persists normalized settings and rejects invalid patterns", async () => {
    const valid = new FormData();
    valid.set("intent", "save");
    valid.set("excludeDirs", "cache\n tmp \n");
    valid.set("excludeFilenames", "thumbs.db");
    valid.set("excludePathPatterns", "^private/\n\\.bak$");
    valid.set("knownGameDirs", "valve\ngearbox");

    const saved = await router.fetch(
      harness.request(routes.admin.scanSettings.action.href(), adminCookie, {
        method: "POST",
        body: valid,
      }),
    );
    assert.equal(saved.status, 303);
    assert.deepEqual(
      JSON.parse(
        (await harness.database.db.query.settings.findFirst({
          where: (settings, { eq }) => eq(settings.key, "scan.excludeDirs"),
        }))!.value,
      ),
      ["cache", "tmp"],
    );

    const invalid = new FormData();
    invalid.set("intent", "save");
    invalid.set("excludePathPatterns", "[");
    const rejected = await router.fetch(
      harness.request(routes.admin.scanSettings.action.href(), adminCookie, {
        method: "POST",
        body: invalid,
      }),
    );
    assert.equal(rejected.status, 400);
    assert.match(await rejected.text(), /Invalid regex patterns/);
  });
});
