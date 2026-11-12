import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";

export async function exerciseAdminForum({
  page,
  context,
  origin,
  name,
  output,
  restart,
}) {
  await page.goto(origin + "/admin");
  const threads = page.locator("details.panel").filter({
    has: page.locator("summary h2").filter({ hasText: /^forum threads/ }),
  });
  await threads.locator("summary").click();
  const thread = threads.locator(".panel").first();
  const pin = thread.locator('form[action$="/pin"]');
  const pinAction = await pin.getAttribute("action");
  const initial = (await pin.locator("button").textContent()).trim();
  await pin.locator("button").click();
  await page.waitForLoadState("load");
  await page.waitForFunction(
    ({ action, before }) =>
      document
        .querySelector(`form[action="${action}"] button`)
        ?.textContent.trim() === (before === "pin" ? "unpin" : "pin"),
    { action: pinAction, before: initial },
  );
  const lockAction = pinAction.replace(/\/pin$/, "/lock");
  const originalLock = (
    await page.locator(`form[action="${lockAction}"] button`).textContent()
  ).trim();
  for (const action of [pinAction, lockAction]) {
    const response = await context.request.post(origin + action, {
      headers: { Origin: origin, "HX-Request": "true" },
    });
    assert.equal(response.status(), 200);
    assert.equal(response.headers()["hx-refresh"], "true");
  }
  await restart(name);
  await page.goto(origin + "/admin");
  assert.equal(
    (
      await page.locator(`form[action="${pinAction}"] button`).textContent()
    ).trim(),
    initial,
  );
  assert.notEqual(
    (
      await page.locator(`form[action="${lockAction}"] button`).textContent()
    ).trim(),
    originalLock,
  );
  const restore = await context.request.post(origin + lockAction, {
    headers: { Origin: origin, "HX-Request": "true" },
  });
  assert.equal(restore.status(), 200);
  await page.reload();
  assert.equal(
    (
      await page.locator(`form[action="${lockAction}"] button`).textContent()
    ).trim(),
    originalLock,
  );
  const counts = {};
  for (const [label, heading] of [
    ["threads", /^forum threads/],
    ["posts", /^recent forum posts/],
  ]) {
    const panel = page
      .locator("details.panel")
      .filter({ has: page.locator("summary h2").filter({ hasText: heading }) });
    await panel.evaluate((e) => (e.open = true));
    counts[label] = await panel.locator(":scope > .panel").count();
    assert.ok(counts[label] > 0);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await panel.screenshot({
        path: `${output}/${name}-${label}-${width}.png`,
      });
    }
  }
  assert.equal(await page.locator('a[href="/admin/export"]').count(), 1);
  await page.setViewportSize({ width: 1280, height: 900 });
  const storagePanel = page
    .locator("details.panel")
    .filter({
      has: page.locator("summary h2").filter({ hasText: /^storage health$/ }),
    });
  await storagePanel.locator("summary").click();
  await storagePanel
    .getByRole("button", { name: "scan for orphans", exact: true })
    .click();
  await storagePanel
    .getByRole("heading", { name: "orphaned files", exact: true })
    .waitFor();
  await storagePanel
    .getByRole("heading", { name: "orphaned records", exact: true })
    .waitFor();
  assert.equal(
    await storagePanel.getByText("none found.", { exact: true }).count(),
    2,
  );
  await storagePanel.screenshot({
    path: `${output}/${name}-storage-health.png`,
  });
  const originalCards = await page
    .locator('form[action$="/card"]')
    .evaluateAll((forms) =>
      forms.map((f) => ({
        action: f.getAttribute("action"),
        fields: Object.fromEntries(new FormData(f)),
      })),
    );
  assert.ok(originalCards.length > 1);
  const requestHeaders = { Origin: origin, Accept: "application/json" };
  for (const [index, color] of [
    [0, "#00ffff"],
    [1, "#123456"],
  ]) {
    const card = originalCards[index];
    assert.equal(
      (
        await context.request.post(origin + card.action, {
          headers: requestHeaders,
          form: { ...card.fields, accent_color: color },
        })
      ).status(),
      200,
    );
  }
  await page.reload();
  const randomize = page.locator(
    'form[action="/admin/cards/randomize-default-colors"]',
  );
  await randomize.evaluate((e) => {
    for (let p = e.parentElement; p; p = p.parentElement)
      if (p.tagName === "DETAILS") p.open = true;
  });
  page.once("dialog", (d) => d.dismiss());
  await randomize.locator("button").click();
  assert.equal(new URL(page.url()).searchParams.has("randomized_cards"), false);
  page.once("dialog", (d) => d.accept());
  await randomize.locator("button").click();
  await page.waitForURL((u) => u.searchParams.has("randomized_cards"));
  const randomizedCount = Number(
    new URL(page.url()).searchParams.get("randomized_cards"),
  );
  assert.ok(randomizedCount >= 1);
  const colorFor = (action) =>
    page.locator(`form[action="${action}"] [name="accent_color"]`).inputValue();
  assert.notEqual(await colorFor(originalCards[0].action), "#00ffff");
  assert.equal(await colorFor(originalCards[1].action), "#123456");
  for (const card of originalCards) {
    const response = await context.request.post(origin + card.action, {
      headers: requestHeaders,
      form: card.fields,
    });
    assert.equal(response.status(), 200);
  }
  await page.reload();
  const restoredCards = await page
    .locator('form[action$="/card"]')
    .evaluateAll((forms) =>
      forms.map((f) => ({
        action: f.getAttribute("action"),
        fields: Object.fromEntries(new FormData(f)),
      })),
    );
  assert.deepEqual(restoredCards, originalCards);
  const created = await context.request.post(origin + "/forum/new", {
    headers: requestHeaders,
    form: {
      title: "Isolated admin moderation fixture",
      content: "Disposable moderation body",
      content_format: "bbcode",
    },
  });
  assert.equal(created.status(), 200);
  const createdData = await created.json();
  const fixtureId = createdData.id;
  assert.ok(Number.isInteger(fixtureId));
  await page.goto(origin + "/admin");
  const fixturePost = page
    .locator("details.panel > .panel")
    .filter({ has: page.locator(`a[href^="/forum/${fixtureId}#post-"]`) });
  assert.equal(await fixturePost.count(), 1);
  const deletePost = fixturePost.locator('form[action$="/delete"]');
  await deletePost.evaluate((e) => {
    for (let p = e.parentElement; p; p = p.parentElement)
      if (p.tagName === "DETAILS") p.open = true;
  });
  const deletePostAction = await deletePost.getAttribute("action");
  page.once("dialog", (d) => d.accept());
  await deletePost.locator("button").click();
  await page.waitForFunction(
    (action) => !document.querySelector(`form[action="${action}"]`),
    deletePostAction,
  );
  const deleteThread = page.locator(
    `form[action="/forum/${fixtureId}/delete"]`,
  );
  await deleteThread.evaluate((e) => {
    for (let p = e.parentElement; p; p = p.parentElement)
      if (p.tagName === "DETAILS") p.open = true;
  });
  page.once("dialog", (d) => d.accept());
  await deleteThread.locator("button").click();
  await page.waitForURL((u) => u.pathname === "/forum");
  assert.equal(
    (await context.request.get(origin + `/forum/${fixtureId}`)).status(),
    404,
  );

  await writeFile(
    `${output}/${name}-forum-admin.json`,
    JSON.stringify(
      {
        status: "PASS",
        counts,
        pinRestored: true,
        lockRestored: true,
        coldRestart: true,
        destructiveControls:
          "actual admin post removal and thread deletion of newly created disposable content",
        randomizedCards: randomizedCount,
        allOriginalCardsRestored: true,
      },
      null,
      2,
    ),
  );
}
