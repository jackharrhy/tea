import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
export async function exerciseChatCopies({
  output,
  oracleRoot,
  authPath,
  restart,
}) {
  const browser = await chromium.launch();
  const results = [];
  const auth = JSON.parse(await readFile(authPath, "utf8"));
  const inventory = JSON.parse(
    await readFile(join(dirname(authPath), "inventory.json"), "utf8"),
  );
  const expectedHistory = Math.min(100, inventory.counts.chat_messages);

  const nonce = "Isolated chat copy " + Date.now();
  let phase = "start";
  async function stage(next) {
    phase = next;
    await writeFile(
      output + "/browser-progress.json",
      JSON.stringify({ phase, checkedAt: new Date().toISOString() }, null, 2),
    );
  }

  try {
    for (const [name, origin] of [
      ["oracle", "http://127.0.0.1:18964"],
      ["native", "http://127.0.0.1:18974"],
    ]) {
      const receiverContext = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        serviceWorkers: "block",
      });
      const senderContext = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        serviceWorkers: "block",
      });
      for (const context of [receiverContext, senderContext])
        await context.route("**/*", (r) =>
          [origin, "http://127.0.0.1:18975"].includes(
            new URL(r.request().url()).origin,
          )
            ? r.continue()
            : r.abort(),
        );
      try {
        const receiver = await receiverContext.newPage();
        const sender = await senderContext.newPage();
        const errors = [];
        receiver.on("pageerror", (error) => errors.push(error.message));
        sender.on("pageerror", (error) => errors.push(error.message));
        await stage(`${name}-anonymous`);
        assert.equal((await receiver.goto(origin + "/chat")).status(), 200);
        await receiver
          .locator("#chat-presence")
          .getByText("nobody here", { exact: true })
          .waitFor();
        const initial = await receiver.locator(".chat-msg").count();
        assert.equal(initial, expectedHistory);
        const denied = await receiverContext.request.post(origin + "/chat", {
          headers: { Origin: origin },
          form: { message: nonce + " unauthorized" },
        });
        assert.equal(denied.status(), 403);
        await stage(`${name}-login`);
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
          await senderContext.addCookies([
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
          await sender.goto(origin + "/login");
          await sender
            .getByRole("button", {
              name: "Continue as local user",
              exact: true,
            })
            .click();
          await sender.waitForURL(
            (url) => url.origin === origin && url.pathname.startsWith("/u/"),
          );
        }
        const profile = await (
          await senderContext.request.get(origin + "/settings", {
            headers: { Accept: "application/json" },
          })
        ).json();
        assert.ok(profile.username);
        await sender.goto(origin + "/chat");
        await sender.locator(".chat-input").waitFor();
        const marker = nonce + " " + name;
        await stage(`${name}-send`);
        const message = marker + " <script>literal only</script>";
        await sender.locator('.chat-input [name="message"]').fill(message);
        await sender.getByRole("button", { name: "send", exact: true }).click();
        await sender.waitForFunction(
          () => document.querySelector(".chat-input input").value === "",
        );
        await receiver
          .locator(".chat-text")
          .getByText(message, { exact: true })
          .waitFor();
        assert.equal(await receiver.locator(".chat-msg").count(), initial + 1);
        assert.equal(
          await receiver
            .locator(".chat-text")
            .getByText(message, { exact: true })
            .count(),
          1,
        );
        assert.equal(await receiver.locator(".chat-text script").count(), 0);
        await stage(`${name}-presence`);
        await sender.evaluate(() => window.dispatchEvent(new Event("blur")));
        await receiver
          .locator("#chat-presence")
          .getByText("🟡 " + profile.username, { exact: true })
          .waitFor();
        await sender.evaluate(() => window.dispatchEvent(new Event("focus")));
        await receiver
          .locator("#chat-presence")
          .getByText("🟢 " + profile.username, { exact: true })
          .waitFor();
        await stage(`${name}-reconnect`);
        await receiver.reload();
        await receiver
          .locator(".chat-text")
          .getByText(message, { exact: true })
          .waitFor();
        assert.equal(
          await receiver.locator(".chat-msg").count(),
          Math.min(100, initial + 1),
        );
        await sender
          .locator('.chat-input [name="message"]')
          .fill(marker + " after reconnect");
        await sender.getByRole("button", { name: "send", exact: true }).click();
        await receiver
          .locator(".chat-text")
          .getByText(marker + " after reconnect", { exact: true })
          .waitFor();
        assert.equal(
          await receiver.locator(".chat-msg").count(),
          Math.min(100, initial + 1) + 1,
        );
        await stage(`${name}-cold-restart`);
        await restart(name);
        await sender.reload();
        await receiver.reload();
        await sender.locator(".chat-input").waitFor();
        await receiver
          .locator(".chat-text")
          .getByText(message, { exact: true })
          .waitFor();
        assert.equal(
          await receiver.locator(".chat-msg").count(),
          Math.min(100, initial + 2),
        );
        assert.equal(
          await receiver
            .locator(".chat-text")
            .getByText(marker + " after reconnect", { exact: true })
            .count(),
          1,
        );
        await stage(`${name}-flood`);
        for (let i = 0; i < 20; i++) {
          const r = await senderContext.request.post(origin + "/chat", {
            headers: { Origin: origin, "HX-Request": "true" },
            form: { message: marker + " flood " + i },
          });
          assert.equal(r.status(), 200);
          assert.equal(await r.text(), "");
        }
        const floodedAt = Date.now();
        const blocked = await senderContext.request.post(origin + "/chat", {
          headers: { Origin: origin, "HX-Request": "true" },
          form: { message: marker + " rejected" },
        });
        assert.equal(blocked.status(), 200);
        assert.equal(await blocked.text(), "");
        await receiver
          .locator(".chat-text")
          .getByText(profile.username + " has been timed out for flooding", {
            exact: true,
          })
          .waitFor();
        assert.equal(
          await receiver
            .locator(".chat-text")
            .getByText(marker + " rejected", { exact: true })
            .count(),
          0,
        );
        const normal = await senderContext.request.post(origin + "/chat", {
          headers: { Origin: origin },
          form: { message: marker + " still rejected" },
          maxRedirects: 0,
        });
        assert.equal(normal.status(), 429);
        assert.ok(normal.headers()["content-type"].includes("text/html"));
        const json = await senderContext.request.post(origin + "/chat", {
          headers: { Origin: origin, Accept: "application/json" },
          form: { message: marker + " rejected JSON" },
          maxRedirects: 0,
        });
        assert.equal(json.status(), 429);
        assert.deepEqual(await json.json(), {
          ok: false,
          error: "Too Many Requests",
          status_code: 429,
        });
        await receiver.reload();
        await receiver
          .locator(".chat-text")
          .getByText(marker + " flood 19", { exact: true })
          .waitFor();
        assert.equal(
          await receiver
            .locator(".chat-text")
            .filter({ hasText: marker + " flood " })
            .count(),
          20,
        );
        assert.equal(
          await receiver
            .locator(".chat-user")
            .getByText("system", { exact: true })
            .count(),
          0,
        );
        const retainedText = await receiver
          .locator(".chat-text")
          .allTextContents();
        assert.equal(
          retainedText.filter(
            (text) => text.startsWith(marker) && text.includes("rejected"),
          ).length,
          0,
        );
        await stage(`${name}-timeout-recovery`);
        const remaining = 61000 - (Date.now() - floodedAt);
        if (remaining > 0) await delay(remaining);
        await sender
          .locator('.chat-input [name="message"]')
          .fill(marker + " recovered after timeout");
        await sender.getByRole("button", { name: "send", exact: true }).click();
        await receiver
          .locator(".chat-text")
          .getByText(marker + " recovered after timeout", { exact: true })
          .waitFor();
        await receiver.screenshot({
          path: output + `/${name}-desktop-after-chat.png`,
          fullPage: true,
        });
        await stage(`${name}-mobile-send`);
        await sender.waitForFunction(
          () => document.querySelector(".chat-input input").value === "",
        );
        await sender.setViewportSize({ width: 390, height: 900 });
        await receiver.setViewportSize({ width: 390, height: 900 });
        await sender
          .locator('.chat-input [name="message"]')
          .fill(marker + " mobile message");
        await sender.getByRole("button", { name: "send", exact: true }).click();
        await receiver
          .locator(".chat-text")
          .getByText(marker + " mobile message", { exact: true })
          .waitFor();
        await receiver.screenshot({
          path: output + `/${name}-mobile-after-chat.png`,
          fullPage: true,
        });
        await sender.screenshot({
          path: output + `/${name}-mobile-sender.png`,
          fullPage: true,
        });
        assert.equal(errors.length, 0);
        results.push({
          name,
          publicReceiver: true,
          signedInSender: true,
          literalHTMLSafe: true,
          noHistoryReplay: true,
          presenceIdleActive: true,
          reconnect: true,
          coldPersistence: true,
          twentyAccepted: true,
          floodNotice: true,
          rejectedNotStored: true,
          actualTimeoutRecovery: true,
          mobileSendReceive: true,
          systemNotStored: true,
          browserErrors: 0,
        });
      } finally {
        await senderContext.close();
        await receiverContext.close();
      }
    }
    await writeFile(
      output + "/browser.json",
      JSON.stringify(
        { status: "PASS", results, productionTouched: false },
        null,
        2,
      ),
    );
  } catch (error) {
    await writeFile(
      output + "/browser-failure.json",
      JSON.stringify(
        { status: "FAIL", phase, message: error.message },
        null,
        2,
      ),
    );
    throw new Error("Disposable chat browser failed at " + phase, {
      cause: error,
    });
  } finally {
    await browser.close();
  }
}
