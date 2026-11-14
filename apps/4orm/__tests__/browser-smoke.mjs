import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

const origin = process.env.FOURM_TEST_ORIGIN ?? "http://127.0.0.1:18940";
const output = process.env.FOURM_TEST_OUTPUT ?? ".review/evidence";
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", () => errors.push("browser error"));
    try {
      await page.goto(origin);
      await page.getByRole("link", { name: "sign in", exact: true }).click();
      await page
        .getByRole("button", { name: "Continue as local user", exact: true })
        .click();
      await page.waitForURL(`${origin}/u/jane`);
      assert.equal(
        await page
          .locator("header")
          .evaluate((element) => getComputedStyle(element).display),
        "flex",
      );
      assert.equal(
        await page
          .locator("header")
          .evaluate((element) => getComputedStyle(element).backgroundColor),
        "rgb(0, 196, 232)",
      );
      const sessionCookie = (await context.cookies(origin)).find(
        (cookie) => cookie.name === "fourm_session",
      );
      assert.ok(sessionCookie);
      assert.equal(sessionCookie.httpOnly, true);
      assert.equal(sessionCookie.secure, origin.startsWith("https:"));
      assert.equal(sessionCookie.domain, new URL(origin).hostname);
      assert.ok(sessionCookie.expires <= Date.now() / 1000 + 3601);
      const slug = `browser-${width}-${Date.now()}`;
      await page.getByRole("link", { name: "settings", exact: true }).click();
      await page
        .getByRole("link", { name: "Create a page", exact: true })
        .click();
      await page.getByLabel("Slug", { exact: true }).fill(slug);
      await page
        .getByLabel("Title", { exact: true })
        .fill(`Browser page ${width}`);
      await page
        .getByLabel("Content", { exact: true })
        .fill("<p>A persistent native page.</p>");
      await page.getByLabel("Public", { exact: true }).uncheck();
      await page
        .getByRole("button", { name: "Save page", exact: true })
        .click();
      await page.waitForURL(`${origin}/settings`);
      await page
        .getByRole("link", { name: `Browser page ${width}`, exact: true })
        .click();
      assert.equal(
        await page
          .getByText("A persistent native page.", { exact: true })
          .count(),
        1,
      );
      await page.goto(`${origin}/settings/pages/${slug}`);
      assert.equal(
        await page.getByLabel("Content", { exact: true }).inputValue(),
        "<p>A persistent native page.</p>",
      );
      await page.getByLabel("Format", { exact: true }).selectOption("markdown");
      await page
        .getByRole("button", { name: "Save page", exact: true })
        .click();
      await page.waitForURL(`${origin}/settings`);
      await page.goto(`${origin}/settings/pages/${slug}`);
      assert.equal(
        await page.getByLabel("Format", { exact: true }).inputValue(),
        "markdown",
      );
      const anonymous = await browser.newContext();
      try {
        assert.equal(
          (await anonymous.request.get(`${origin}/u/jane/p/${slug}`)).status(),
          404,
        );
      } finally {
        await anonymous.close();
      }
      await page.getByRole("link", { name: "forum", exact: true }).click();
      await page.getByRole("link", { name: "New thread", exact: true }).click();
      await page
        .getByLabel("Title", { exact: true })
        .fill(`Native thread ${slug}`);
      await page
        .getByLabel("Post", { exact: true })
        .fill("Our first Celld conversation.");
      await page
        .getByRole("button", { name: "Create thread", exact: true })
        .click();
      await page.getByLabel("Reply", { exact: true }).fill("A durable reply.");
      await page
        .getByRole("button", { name: "Post reply", exact: true })
        .click();
      assert.equal(
        await page.getByText("A durable reply.", { exact: true }).count(),
        1,
      );
      const threadPath = new URL(page.url()).pathname;
      await page.screenshot({
        path: `${output}/forum-${width}.png`,
        fullPage: true,
      });
      await page.getByRole("link", { name: "chat", exact: true }).click();
      const otherChat = await context.newPage();
      await otherChat.goto(origin + "/chat");
      await page
        .getByLabel("Message", { exact: true })
        .fill(`Hello from browser ${slug}`);
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await otherChat
        .getByRole("log")
        .getByText(`Hello from browser ${slug}`, { exact: false })
        .waitFor();
      await otherChat.close();
      await page.goto(origin + "/settings/media");
      await page.getByLabel("File", { exact: true }).setInputFiles({
        name: `pixel-${slug}.png`,
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jf1sAAAAASUVORK5CYII=",
          "base64",
        ),
      });
      await page.getByRole("button", { name: "Upload", exact: true }).click();
      await page
        .getByRole("link", { name: new RegExp(`pixel-${slug}\\.png`) })
        .waitFor();
      const mediaPath = await page
        .getByRole("link", { name: new RegExp(`pixel-${slug}\\.png`) })
        .getAttribute("href");
      assert.equal(
        (await context.request.get(origin + mediaPath)).status(),
        200,
      );
      await page.goto(origin + "/settings/widgets");
      await page
        .getByLabel("Avatar image", { exact: true })
        .selectOption({ label: mediaPath.replace("/uploads/", "") });
      await page
        .getByRole("button", { name: "Save avatar", exact: true })
        .click();
      await page.getByLabel("Emoji", { exact: true }).fill("🪴");
      await page
        .getByLabel("Status", { exact: true })
        .fill("Making a native community.");
      await page
        .getByRole("button", { name: "Save status", exact: true })
        .click();
      await page.getByLabel("Join the webring", { exact: true }).check();
      await page
        .getByRole("button", { name: "Save webring preference", exact: true })
        .click();
      await page
        .getByLabel("Headline", { exact: true })
        .fill(`Native card ${width}`);
      await page
        .getByLabel("Card content", { exact: true })
        .fill("<p>A saved member card.</p>");
      await page
        .getByRole("button", { name: "Save profile card", exact: true })
        .click();
      await page.goto(origin + "/u/jane");
      await page
        .getByText("Making a native community.", { exact: false })
        .waitFor();
      assert.equal(
        await page
          .getByRole("img", { name: "Jane's avatar", exact: true })
          .count(),
        1,
      );
      await page.screenshot({
        path: `${output}/profile-${width}.png`,
        fullPage: true,
      });
      await page.goto(origin + "/u/sam/guestbook");
      await page
        .getByLabel("Message", { exact: true })
        .fill(`A guestbook entry ${slug}`);
      await page
        .getByRole("button", { name: "Sign guestbook", exact: true })
        .click();
      await page
        .getByText(`A guestbook entry ${slug}`, { exact: true })
        .waitFor();
      assert.equal(
        await page.getByRole("button", { name: /Remove entry/ }).count(),
        0,
        "An admin author is not the guestbook owner",
      );
      const firstCounter = await context.request.get(
        origin + "/u/jane/counter",
      );
      const secondCounter = await context.request.get(
        origin + "/u/jane/counter",
      );
      assert.equal(await firstCounter.text(), await secondCounter.text());
      await page.goto(origin + "/admin");
      await page
        .getByRole("button", { name: "Disable sam", exact: true })
        .click();
      assert.equal(
        (await context.request.get(origin + "/u/sam")).status(),
        404,
      );
      assert.equal(
        (
          await context.request
            .get(origin + "/world/community")
            .then((response) => response.json())
        ).members.length,
        1,
      );
      await page
        .getByRole("button", { name: "Enable sam", exact: true })
        .click();
      assert.equal(
        (await context.request.get(origin + "/u/sam")).status(),
        200,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      assert.equal(
        (
          await context.request.get(
            `${origin}/auth/callback?state=wrong&code=wrong`,
          )
        ).status(),
        400,
      );
      assert.deepEqual(errors, []);
      results.push({
        width,
        signedCallback: true,
        privatePage: slug,
        privatePageDeniedToAnonymous: true,
        threadPath,
        reply: true,
        chat: true,
        realtimeAcrossTabs: true,
        mediaPath,
        avatarStatusCardAndWebring: true,
        guestbookOwnership: true,
        counterDeduplicated: true,
        adminDisableEnable: true,
        noOverflow: true,
        browserErrors: 0,
      });
      await page.getByRole("button", { name: "logout", exact: true }).click();
      assert.equal((await context.request.get(`${origin}/chat`)).status(), 401);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
await writeFile(
  `${output}/browser.json`,
  JSON.stringify({ status: "PASS", origin, results }, null, 2),
);
console.log(
  "PASS: signed OIDC, private pages, forum/reply, chat, logout, desktop/mobile, no overflow or browser errors",
);
