import assert from "node:assert/strict";
const accept = (dialog) => dialog.accept();
import { createHash } from "node:crypto";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7QAAAABJRU5ErkJggg==",
  "base64",
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jsonHeaders = { Accept: "application/json" };
async function settings(page, origin) {
  return (
    await page
      .context()
      .request.get(origin + "/settings", { headers: jsonHeaders })
  ).json();
}
async function media(page, origin) {
  return (
    await page
      .context()
      .request.get(origin + "/settings/media", { headers: jsonHeaders })
  ).json();
}
async function renameUsername(page, origin, username) {
  await page.goto(origin + "/settings");
  const form = page.locator('form[action="/settings/username"]');
  await form.locator('input[name="username"]').fill(username);
  await form
    .getByRole("button", { name: "save username", exact: true })
    .click();
  await page
    .locator("#username-status")
    .getByText("saved.", { exact: true })
    .waitFor();
  await page.reload();
  assert.equal(
    await page.locator('form[action="/settings/username"] input').inputValue(),
    username,
  );
}
export async function mediaWorkflows(page, origin) {
  const baseline = await media(page, origin),
    original = await settings(page, origin),
    created = new Set();
  const marker = "isolated-parity-" + Date.now();
  const report = {};
  try {
    await page.goto(origin + "/settings/media");
    const upload = page.locator('form[action="/settings/media/upload"]');
    await upload.locator('input[type="file"]').setInputFiles({
      name: "fixture.PNG",
      mimeType: "image/png",
      buffer: png,
    });
    await upload.locator('[name="filename"]').fill(marker + " initial.txt");
    await upload.getByRole("button", { name: "upload", exact: true }).click();
    const first = page.locator(".media-item").filter({
      has: page
        .locator("summary code")
        .getByText(marker + "-initial.png", { exact: true }),
    });
    await first.waitFor();
    const id = Number((await first.getAttribute("id")).slice(6));
    created.add(id);
    await first.locator("summary").click();
    assert.equal(
      await first.locator("img").getAttribute("src"),
      `/uploads/${original.username}/${marker}-initial.png`,
    );
    let form = first.locator('form[action$="/alt"]');
    await form.locator('input[name="alt_text"]').fill("Isolated image alt");
    await form.getByRole("button", { name: "save alt", exact: true }).click();
    const card = page.locator(`#media-${id}`);
    await card
      .locator('img[alt="Isolated image alt"]')
      .waitFor({ state: "attached" });
    await card.locator("summary").click();
    form = card.locator('form[action$="/rename"]');
    await form.locator('input[name="filename"]').fill(marker + " renamed.txt");
    await form.getByRole("button", { name: "rename", exact: true }).click();
    await card
      .locator("summary code")
      .getByText(marker + "-renamed.png", { exact: true })
      .waitFor();
    await page.reload();
    const item = (await media(page, origin)).items.find(
      (candidate) => candidate.id === id,
    );
    assert.equal(
      item.storage_path,
      `${original.username}/${marker}-renamed.png`,
    );
    assert.equal(item.alt_text, "Isolated image alt");
    const bytes = await page
      .context()
      .request.get(origin + "/uploads/" + item.storage_path);
    assert.equal(sha(await bytes.body()), sha(png));
    assert.equal(
      (
        await page
          .context()
          .request.get(
            origin + `/uploads/${original.username}/${marker}-initial.png`,
          )
      ).status(),
      404,
    );
    const reopened = page.locator(`#media-${id}`);
    await reopened.locator("summary").click();
    page.on("dialog", accept);
    try {
      await reopened
        .getByRole("button", { name: "delete", exact: true })
        .click();
      await reopened.waitFor({ state: "detached" });
    } finally {
      page.off("dialog", accept);
    }
    created.delete(id);
    assert.deepEqual((await media(page, origin)).items, baseline.items);
    report.uploadOptionalNameExtension = true;
    report.altSaveReopen = true;
    report.renameRetainsIdAndBytes = true;
    report.deleteRemovesOnlyFixture = true;
    const username = "parity-" + Date.now();
    await renameUsername(page, origin, username);
    const renamed = await settings(page, origin);
    assert.equal(renamed.username, username);
    assert.equal(renamed.content, original.content);
    assert.equal(renamed.custom_html, original.custom_html);
    assert.deepEqual(
      renamed.media_items,
      original.media_items.map((entry) => ({
        ...entry,
        storage_path: entry.storage_path.startsWith(original.username + "/")
          ? username + entry.storage_path.slice(original.username.length)
          : entry.storage_path,
      })),
    );
    const sample = renamed.media_items[0],
      prior = original.media_items[0];
    if (sample) {
      const moved = await page
        .context()
        .request.get(origin + "/uploads/" + sample.storage_path);
      assert.equal(moved.status(), 200);
      assert.equal(
        (
          await page
            .context()
            .request.get(origin + "/uploads/" + prior.storage_path)
        ).status(),
        404,
      );
    }
    await renameUsername(page, origin, original.username);
    const restored = await settings(page, origin);
    assert.equal(restored.username, original.username);
    assert.deepEqual(restored.media_items, original.media_items);
    report.usernameSaveReopenAndMediaRelocation = true;
    report.originalIdsPathsAndSettingsRestored = true;
    return report;
  } finally {
    for (const id of created) {
      await page
        .context()
        .request.post(origin + `/settings/media/${id}/delete`, {
          headers: { ...jsonHeaders, Origin: origin },
        });
    }
    const current = await settings(page, origin);
    if (current.username !== original.username) {
      const r = await page
        .context()
        .request.post(origin + "/settings/username", {
          form: { username: original.username },
          headers: { ...jsonHeaders, Origin: origin },
        });
      assert.equal(r.status(), 200);
    }
    assert.deepEqual((await media(page, origin)).items, baseline.items);
  }
}
