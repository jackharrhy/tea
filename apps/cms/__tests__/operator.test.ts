import { it } from "remix/test";
import * as assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { parseFixtureSites } from "./sites.ts";
import { createApp } from "../app.ts";
import { OperatorStore } from "../operator/store.ts";

it("keeps operator access separate, hands off once, and revokes site access on sign-out", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cms-operator-"));
  const host = "http://preview.localhost";
  const sites = parseFixtureSites(
    [
      {
        id: "andrew",
        template: "andrew",
        name: "Andrew",
        origin: `${host}:4101`,
        aliases: [],
        preview: true,
      },
      {
        id: "luke",
        template: "luke",
        name: "Luke",
        origin: `${host}:4102`,
        aliases: [],
        preview: true,
      },
    ],
    dir,
  );
  const operatorOrigin = `${host}:4103`;
  const store = new OperatorStore(":memory:");
  store.sqlite
    .prepare("INSERT INTO users(email,password_hash) VALUES (?,?)")
    .run("operator@test.local", await bcrypt.hash("operator-test-password", 4));
  const app = await createApp(sites, { origin: operatorOrigin, store });
  try {
    const request = (url: string, init?: RequestInit) =>
      app.fetch(new Request(url, init));
    assert.equal((await request(operatorOrigin)).status, 303);
    const wrongOrigin = await request(operatorOrigin + "/login", {
      method: "POST",
      headers: { Origin: sites[0].origin },
      body: new URLSearchParams({
        email: "operator@test.local",
        password: "operator-test-password",
      }),
    });
    assert.equal(wrongOrigin.status, 403);
    const loginPage = await request(operatorOrigin + "/login");
    const csrfCookie = loginPage.headers.get("set-cookie")!.split(";")[0];
    const csrf = csrfCookie.split("=")[1];
    const missingCsrf = await request(operatorOrigin + "/login", {
      method: "POST",
      headers: { Origin: operatorOrigin, Cookie: csrfCookie },
      body: new URLSearchParams({
        email: "operator@test.local",
        password: "operator-test-password",
      }),
    });
    assert.equal(missingCsrf.status, 403);
    const login = await request(operatorOrigin + "/login", {
      method: "POST",
      headers: { Origin: operatorOrigin, Cookie: csrfCookie },
      body: new URLSearchParams({
        csrf,
        email: "operator@test.local",
        password: "operator-test-password",
      }),
    });
    assert.equal(login.status, 303);
    const operatorCookie = login.headers.get("set-cookie")!.split(";")[0];
    const cookies = operatorCookie + "; " + csrfCookie;
    assert.match(operatorCookie, /^tea-operator-session=/);
    const dashboard = await request(operatorOrigin, {
      headers: { Cookie: cookies },
    });
    assert.equal(dashboard.status, 200);
    const html = await dashboard.text();
    assert.match(html, /Andrew/);
    assert.match(html, /Luke/);
    assert.match(html, /Healthy/);
    assert.ok(!html.includes("operator-test-password"));

    async function enter(site: "andrew" | "luke") {
      const siteConfig = sites.find((item) => item.id === site)!;
      const handoff = await request(operatorOrigin + "/enter/" + site, {
        method: "POST",
        headers: { Origin: operatorOrigin, Cookie: cookies },
        body: new URLSearchParams({ csrf }),
      });
      assert.equal(handoff.status, 303);
      const ticketUrl = handoff.headers.get("location")!;
      assert.ok(
        ticketUrl.startsWith(siteConfig.origin + "/tea/operator-enter?ticket="),
      );
      if (site === "andrew")
        assert.equal(
          (await request(ticketUrl.replace(":4101", ":4102"))).status,
          403,
        );
      const accepted = await request(ticketUrl);
      assert.equal(accepted.status, 303);
      assert.equal((await request(ticketUrl)).status, 403);
      const cookie = accepted.headers.get("set-cookie")!.split(";")[0];
      assert.ok(cookie.startsWith(`tea-operator-${site}=`));
      return cookie;
    }

    const andrewCookie = await enter("andrew");
    const lukeCookie = await enter("luke");
    assert.equal(
      (
        await request(sites[0].origin + "/tea/admin", {
          headers: { Cookie: andrewCookie },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(sites[1].origin + "/tea/admin", {
          headers: { Cookie: lukeCookie },
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request(sites[1].origin + "/tea/admin", {
          headers: { Cookie: andrewCookie },
        })
      ).status,
      303,
    );
    const logout = await request(operatorOrigin + "/logout", {
      method: "POST",
      headers: { Origin: operatorOrigin, Cookie: cookies },
      body: new URLSearchParams({ csrf }),
    });
    assert.equal(logout.status, 303);
    for (const [site, cookie] of [
      [sites[0], andrewCookie],
      [sites[1], lukeCookie],
    ] as const)
      assert.equal(
        (
          await request(site.origin + "/tea/admin", {
            headers: { Cookie: cookie },
          })
        ).status,
        303,
      );
  } finally {
    app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
