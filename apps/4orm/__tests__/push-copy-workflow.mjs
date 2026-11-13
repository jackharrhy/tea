import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
export async function exercisePushCopies({
  output,
  oracleRoot,
  authPath,
  restart,
}) {
  const auth = JSON.parse(await readFile(authPath, "utf8"));
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const [name, origin] of [
      ["oracle", "http://127.0.0.1:18964"],
      ["native", "http://127.0.0.1:18974"],
    ]) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        serviceWorkers: "block",
      });
      await context.route("**/*", (r) =>
        [origin, "http://127.0.0.1:18975"].includes(
          new URL(r.request().url()).origin,
        )
          ? r.continue()
          : r.abort(),
      );
      try {
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        for (const path of ["/api/push/devices"]) {
          assert.equal(
            (await context.request.get(origin + path)).status(),
            401,
          );
        }
        for (const path of [
          "/api/push/subscribe",
          "/api/push/unsubscribe",
          "/api/push/devices/1/delete",
        ]) {
          assert.equal(
            (
              await context.request.post(origin + path, {
                headers: { Origin: origin },
                data: {},
              })
            ).status(),
            401,
          );
        }
        if (name === "oracle") {
          const cookie = spawnSync(
            "/home/jack/repos/personal/4orm/.venv/bin/python",
            [
              fileURLToPath(new URL("./oracle-session.py", import.meta.url)),
              oracleRoot,
              String(auth.userId),
            ],
            { encoding: "utf8" },
          );
          assert.equal(cookie.status, 0);
          await context.addCookies([
            {
              name: "session",
              value: cookie.stdout,
              domain: "127.0.0.1",
              path: "/",
              httpOnly: true,
              sameSite: "Lax",
            },
          ]);
        } else {
          await page.goto(origin + "/login");
          await page
            .getByRole("button", {
              name: "Continue as local user",
              exact: true,
            })
            .click();
          await page.waitForURL(
            (u) => u.origin === origin && u.pathname.startsWith("/u/"),
          );
        }
        const list = async () => {
          const r = await context.request.get(origin + "/api/push/devices", {
            headers: { Accept: "application/json" },
          });
          assert.equal(r.status(), 200);
          return r.json();
        };
        const initial = await list();
        const device = "isolated-device-" + Date.now();
        const sub = {
          device_id: device,
          device_name: "isolated laptop",
          endpoint: "https://push.invalid/isolated",
          keys: { p256dh: "isolated-key", auth: "isolated-auth" },
        };
        const send = async (path, data, headers = {}) =>
          context.request.post(origin + path, {
            headers: { Origin: origin, ...headers },
            data,
          });
        assert.equal(
          (await send("/api/push/subscribe", { ...sub, keys: {} })).status(),
          400,
        );
        assert.deepEqual(
          await (await send("/api/push/subscribe", sub)).json(),
          { ok: true },
        );
        let devices = await list();
        assert.equal(devices.length, initial.length + 1);
        const row = devices.find((d) => d.device_id === device);
        assert.ok(row);
        assert.deepEqual(Object.keys(row).toSorted(), [
          "created_at",
          "device_id",
          "device_name",
          "id",
        ]);
        assert.deepEqual(
          await (
            await send("/api/push/subscribe", {
              ...sub,
              device_name: "renamed laptop",
              endpoint: "https://push.invalid/replaced",
            })
          ).json(),
          { ok: true },
        );
        assert.equal(
          (await list()).find((d) => d.id === row.id).device_name,
          "renamed laptop",
        );
        await restart(name);
        devices = await list();
        assert.equal(devices.find((d) => d.device_id === device).id, row.id);
        for (const width of [1280, 390]) {
          await page.setViewportSize({ width, height: 300 });
          await page.goto(origin + "/api/push/devices");
          await page
            .getByRole("button", { name: "remove", exact: true })
            .last()
            .waitFor();
          assert.ok(
            (await page.locator("strong").allTextContents()).includes(
              "renamed laptop",
            ),
          );
          const gap = await page
            .locator(".fourm-actions")
            .filter({ hasText: "renamed laptop" })
            .evaluate((e) => {
              const label = e.querySelector("strong").getBoundingClientRect();
              const time = e.querySelector("span").getBoundingClientRect();
              return time.left - label.right;
            });
          assert.ok(
            gap > 0 && gap < 10,
            "Device label and timestamp must retain original whitespace",
          );
          await page.screenshot({
            path: output + `/${name}-devices-${width}.png`,
            fullPage: true,
          });
        }
        const removed = await send(
          `/api/push/devices/${row.id}/delete`,
          {},
          { "HX-Request": "true" },
        );
        assert.equal(removed.status(), 200);
        assert.ok(!(await removed.text()).includes("renamed laptop"));
        assert.deepEqual(await list(), initial);
        await send("/api/push/subscribe", sub);
        assert.deepEqual(
          await (
            await send("/api/push/unsubscribe", { device_id: device })
          ).json(),
          { ok: true },
        );
        assert.deepEqual(await list(), initial);
        assert.equal(errors.length, 0);
        results.push({
          name,
          anonymousDenied: true,
          invalidDenied: true,
          upsertStable: true,
          coldRestart: true,
          privateKeysNotListed: true,
          htmlRemove: true,
          unsubscribe: true,
          baselineRestored: true,
          browserErrors: 0,
        });
      } finally {
        await context.close();
      }
    }
    await writeFile(
      output + "/browser.json",
      JSON.stringify(
        {
          status: "PASS",
          results,
          productionTouched: false,
          outboundDeliveryEnabled: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}
