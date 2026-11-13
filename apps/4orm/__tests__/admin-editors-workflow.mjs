import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
async function openForm(page, action) {
  const form = page.locator(`form[action="${action}"]`);
  const ancestors = await form.evaluate((e) => {
    let p = e.parentElement,
      n = 0;
    while (p) {
      if (p.tagName === "DETAILS") n++;
      p = p.parentElement;
    }
    return n;
  });
  for (let depth = ancestors; depth > 0; depth--) {
    const details = form.locator(`xpath=ancestor::details[${depth}]`);
    if (
      !(await details.getAttribute("open")) &&
      (await details.getAttribute("open")) !== ""
    )
      await details.locator(":scope > summary").click();
  }
  return form;
}
async function values(form) {
  return form.evaluate((e) => Object.fromEntries(new FormData(e).entries()));
}
export async function exerciseAdminEditors({
  page,
  context,
  origin,
  userId,
  name,
  output,
  restart,
}) {
  await page.goto(origin + "/admin");
  const settings = await (
    await context.request.get(origin + "/settings", {
      headers: { Accept: "application/json" },
    })
  ).json();
  const profileAction = `/admin/users/${userId}/profile`;
  const profile = await openForm(page, profileAction);
  const originalProjection = await values(profile);
  const expectedProfile = {
    display_name: "Isolated admin profile",
    content: "<p>Isolated profile content</p>",
    content_format: "html",
    custom_css: "p {color: purple}",
    custom_html: "<aside>Isolated footer</aside>",
    layout: "raw",
  };
  for (const [key, value] of Object.entries(expectedProfile)) {
    const control = profile.locator(`[name="${key}"]`);
    if (await control.evaluate((e) => e.tagName === "SELECT"))
      await control.selectOption(value);
    else await control.fill(value);
  }
  await profile
    .getByRole("button", { name: "save profile", exact: true })
    .click();
  const saved = await (
    await context.request.get(origin + "/settings", {
      headers: { Accept: "application/json" },
    })
  ).json();
  for (const [key, value] of Object.entries(expectedProfile))
    assert.equal(saved[key], value);
  const restoreProfile = Object.fromEntries(
    Object.keys(expectedProfile).map((k) => [k, settings[k] ?? ""]),
  );
  assert.deepEqual(
    await (
      await context.request.post(origin + profileAction, {
        headers: { Origin: origin, Accept: "application/json" },
        form: restoreProfile,
      })
    ).json(),
    { ok: true, message: "saved" },
  );
  await page.goto(origin + "/admin");
  const cardAction = await page
    .locator('form[action$="/card"]')
    .first()
    .getAttribute("action");
  assert.match(cardAction, /^\/admin\/users\/\d+\/card$/);
  let card = await openForm(page, cardAction);
  const originalCard = await values(card);
  const expectedCard = {
    headline: "Isolated card headline",
    content: "<p>Isolated card content</p>",
    content_format: "html",
    accent_color: "#8844aa",
    border_style: "dashed",
    card_css: "strong {color: purple}",
  };
  for (const [key, value] of Object.entries(expectedCard)) {
    const control = card.locator(`[name="${key}"]`);
    if (await control.evaluate((e) => e.tagName === "SELECT"))
      await control.selectOption(value);
    else await control.fill(value);
  }
  await card.getByRole("button", { name: "save card", exact: true }).click();
  await page.reload();
  card = await openForm(page, cardAction);
  assert.deepEqual(await values(card), expectedCard);
  const candidates = await page
    .locator('form[action^="/admin/pages/"]')
    .evaluateAll((forms) =>
      forms
        .map((f) => ({
          action: f.getAttribute("action"),
          length: f.querySelector('[name="content"]').value.length,
        }))
        .toSorted((a, b) => a.length - b.length),
    );
  assert.ok(candidates.length);
  const pageAction = candidates[0].action;
  let editor = await openForm(page, pageAction);
  const originalPage = await values(editor);
  await editor.locator('[name="title"]').fill("Isolated page title");
  await editor.locator('[name="content"]').fill("<p>Isolated page content</p>");
  await editor.locator('[name="content_format"]').selectOption("html");
  await editor.locator('[name="is_public"]').uncheck();
  await editor.getByRole("button", { name: "save page", exact: true }).click();
  await restart(name);
  await page.goto(origin + "/admin");
  editor = await openForm(page, pageAction);
  assert.equal(
    await editor.locator('[name="title"]').inputValue(),
    "Isolated page title",
  );
  assert.equal(
    await editor.locator('[name="content"]').inputValue(),
    "<p>Isolated page content</p>",
  );
  assert.equal(await editor.locator('[name="is_public"]').isChecked(), false);
  card = await openForm(page, cardAction);
  assert.deepEqual(await values(card), expectedCard);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await editor
      .locator("..")
      .screenshot({ path: output + `/${name}-page-editor-${width}.png` });
    await card
      .locator("..")
      .screenshot({ path: output + `/${name}-card-editor-${width}.png` });
  }
  for (const [action, form] of [
    [cardAction, originalCard],
    [pageAction, originalPage],
  ]) {
    const response = await context.request.post(origin + action, {
      headers: { Origin: origin },
      form,
    });
    assert.equal(response.status(), 200);
  }
  await page.goto(origin + "/admin");
  assert.deepEqual(
    await values(await openForm(page, cardAction)),
    originalCard,
  );
  assert.deepEqual(
    await values(await openForm(page, pageAction)),
    originalPage,
  );
  const restored = await (
    await context.request.get(origin + "/settings", {
      headers: { Accept: "application/json" },
    })
  ).json();
  for (const [key, value] of Object.entries(restoreProfile))
    assert.equal(restored[key], value);
  await writeFile(
    output + `/${name}-editor-receipt.json`,
    JSON.stringify(
      {
        status: "PASS",
        profileBackendSavedAndRestored: true,
        sourceProfileProjection: {
          contentBlank: originalProjection.content === "",
          customCSSBlank: originalProjection.custom_css === "",
        },
        cardSaveReopen: true,
        pageSaveReopen: true,
        coldRestart: true,
        restored: true,
        productionTouched: false,
      },
      null,
      2,
    ),
  );
}
