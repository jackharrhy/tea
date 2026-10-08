import * as assert from "remix/assert";
import { afterEach, beforeEach, describe, it } from "remix/test";

import { sessions } from "#db";

import { routes } from "../../../routes.ts";
import {
  adminCookie,
  createRouterHarness,
  router,
  type RouterHarness,
} from "../../../../__tests__/router-harness.ts";

let harness: RouterHarness;

beforeEach(async () => {
  harness = await createRouterHarness();
});

afterEach(() => harness.close());

describe("settings mutations", () => {
  it("logs out through the router, deletes the session, and clears the cookie", async () => {
    const form = new FormData();
    form.set("intent", "logout");

    const response = await router.fetch(
      harness.request(routes.settings.action.href(), adminCookie, {
        method: "POST",
        body: form,
      }),
    );

    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), routes.home.href());
    assert.match(
      response.headers.get("set-cookie") ?? "",
      /artbin_session=.*Max-Age=0/,
    );
    assert.equal((await harness.database.db.select().from(sessions)).length, 1);
  });
});
