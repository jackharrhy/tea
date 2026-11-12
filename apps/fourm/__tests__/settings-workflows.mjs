import assert from "node:assert/strict";
const accept = (dialog) => dialog.accept();

async function editCodeMirror(page, form, name, text) {
  const textarea = form.locator(`textarea[name="${name}"]`);
  const editor = textarea
    .locator("xpath=preceding-sibling::*[1]")
    .locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(text);
  assert.equal(await textarea.inputValue(), text);
}
async function openSection(page, title) {
  const details = page
    .locator("details")
    .filter({ has: page.locator("summary").getByText(title, { exact: true }) });
  if (!(await details.getAttribute("open")))
    await details.locator("summary").first().click();
  return details;
}
export async function settingsWorkflows(page, origin) {
  const original = {};
  const report = {};
  await page.goto(origin + "/settings");
  for (const name of ["custom_css", "guestbook_css", "guestbook_html"])
    original[name] = await page
      .locator(`textarea[name="${name}"]`)
      .inputValue();
  const notifications = page.locator('form[action="/settings/notifications"]');
  original.notifications_enabled = await notifications
    .locator('[name="notifications_enabled"]')
    .isChecked();
  original.watch_all_threads = await notifications
    .locator('[name="watch_all_threads"]')
    .isChecked();
  const profileUsername = await page
    .locator('form[action="/settings/username"] input')
    .inputValue();
  try {
    await openSection(page, "css");
    let form = page.locator('form[action="/settings/css"]');
    const css = "/* isolated parity save */\n" + original.custom_css;
    await editCodeMirror(page, form, "custom_css", css);
    await form.getByRole("button", { name: "save css", exact: true }).click();
    await page
      .locator("#css-status")
      .getByText("saved.", { exact: true })
      .waitFor();
    await page.reload();
    assert.equal(
      await page.locator('textarea[name="custom_css"]').inputValue(),
      css,
    );
    report.cssSaveReopen = true;
    await openSection(page, "guestbook");
    form = page.locator('form[action="/settings/guestbook"]');
    const guestbookCSS =
      "/* isolated embedded widget save */\n" + original.guestbook_css;
    await editCodeMirror(page, form, "guestbook_css", guestbookCSS);
    await form
      .getByRole("button", { name: "save guestbook", exact: true })
      .click();
    await page
      .locator("#guestbook-status")
      .getByText("saved.", { exact: true })
      .waitFor();
    const widget = await page
      .context()
      .request.get(origin + "/u/" + profileUsername + "/guestbook");
    assert.equal(widget.status(), 200);
    assert.ok((await widget.text()).includes("isolated embedded widget save"));
    await page.reload();
    assert.equal(
      await page.locator('textarea[name="guestbook_css"]').inputValue(),
      guestbookCSS,
    );
    assert.equal(
      await page.locator('textarea[name="guestbook_html"]').inputValue(),
      original.guestbook_html,
    );
    report.guestbookStyleSaveReopenAndRender = true;
    await openSection(page, "notifications");
    form = page.locator('form[action="/settings/notifications"]');
    await form
      .locator('[name="notifications_enabled"]')
      .setChecked(!original.notifications_enabled);
    await form
      .locator('[name="watch_all_threads"]')
      .setChecked(!original.watch_all_threads);
    await form.getByRole("button", { name: "save", exact: true }).click();
    await page
      .locator("#notif-status")
      .getByText("saved.", { exact: true })
      .waitFor();
    await page.reload();
    assert.equal(
      await page.locator('[name="notifications_enabled"]').isChecked(),
      !original.notifications_enabled,
    );
    assert.equal(
      await page.locator('[name="watch_all_threads"]').isChecked(),
      !original.watch_all_threads,
    );
    report.preferencesSaveReopen = true;
    await openSection(page, "music player");
    const order = () =>
      page
        .locator('#playlist-section form[action$="/remove"]')
        .evaluateAll((forms) =>
          forms.map((element) =>
            element.getAttribute("action").split("/").at(-2),
          ),
        );
    const before = await order();
    if (await page.locator('form[action="/settings/player/add"]').count()) {
      await page
        .locator('form[action="/settings/player/add"]')
        .getByRole("button", { name: "add to playlist", exact: true })
        .click();
      await page.waitForFunction(
        (count) =>
          document.querySelectorAll('#playlist-section form[action$="/remove"]')
            .length === count,
        before.length + 1,
      );
      const after = await order(),
        id = after.at(-1);
      assert.deepEqual(after.slice(0, -1), before);
      if (before.length) {
        await page
          .locator(`form[action="/settings/player/${id}/move"]`)
          .filter({ has: page.locator('input[value="up"]') })
          .getByRole("button")
          .click();
        await page.waitForFunction(
          (expected) =>
            [
              ...document.querySelectorAll(
                '#playlist-section form[action$="/remove"]',
              ),
            ]
              .at(-2)
              ?.getAttribute("action")
              .includes("/" + expected + "/"),
          id,
        );
        await page
          .locator(`form[action="/settings/player/${id}/move"]`)
          .filter({ has: page.locator('input[value="down"]') })
          .getByRole("button")
          .click();
        await page.waitForFunction(
          (expected) =>
            [
              ...document.querySelectorAll(
                '#playlist-section form[action$="/remove"]',
              ),
            ]
              .at(-1)
              ?.getAttribute("action")
              .includes("/" + expected + "/"),
          id,
        );
      }
      await page
        .locator(`form[action="/settings/player/${id}/remove"]`)
        .getByRole("button", { name: "remove", exact: true })
        .click();
      await page.waitForFunction(
        (count) =>
          document.querySelectorAll('#playlist-section form[action$="/remove"]')
            .length === count,
        before.length,
      );
      assert.deepEqual(await order(), before);
      report.playlistAddMoveRemove = true;
    }
    const slug = "isolated-parity-" + Date.now();
    const created = await page
      .context()
      .request.post(origin + "/settings/pages", {
        headers: { Origin: origin },
        form: {
          slug,
          title: "Isolated parity workflow",
          content: "<p>Local copy only.</p>",
          content_format: "html",
          layout: "default",
        },
        maxRedirects: 0,
      });
    assert.equal(created.status(), 303);
    const duplicate = await page
      .context()
      .request.post(origin + "/settings/pages", {
        headers: { Origin: origin, Accept: "application/json" },
        form: {
          slug,
          title: "Must not overwrite",
          content: "wrong",
          content_format: "html",
          layout: "default",
        },
      });
    assert.equal(duplicate.status(), 200);
    assert.deepEqual(await duplicate.json(), {
      ok: false,
      error: "a page with that slug already exists",
    });
    await page.goto(origin + `/settings/pages/${slug}/edit`);
    await page.locator('[name="title"]').fill("Isolated parity edit");
    await page
      .getByRole("button", { name: "save changes", exact: true })
      .click();
    await page
      .locator("#edit-status")
      .getByText("saved.", { exact: true })
      .waitFor();
    await page.reload();
    assert.equal(
      await page.locator('[name="title"]').inputValue(),
      "Isolated parity edit",
    );
    const deleted = await page
      .context()
      .request.post(origin + `/settings/pages/${slug}/delete`, {
        headers: { Origin: origin },
        maxRedirects: 0,
      });
    assert.equal(deleted.status(), 303);
    assert.equal(
      (
        await page
          .context()
          .request.get(origin + `/u/${profileUsername}/page/${slug}`)
      ).status(),
      404,
    );
    report.pageCreateEditReopenDelete = true;
  } finally {
    for (const [path, form] of [
      ["css", { custom_css: original.custom_css }],
      [
        "guestbook",
        {
          guestbook_css: original.guestbook_css,
          guestbook_html: original.guestbook_html,
        },
      ],
      [
        "notifications",
        {
          ...(original.notifications_enabled
            ? { notifications_enabled: "on" }
            : {}),
          ...(original.watch_all_threads ? { watch_all_threads: "on" } : {}),
        },
      ],
    ]) {
      const result = await page
        .context()
        .request.post(origin + "/settings/" + path, {
          headers: { Origin: origin },
          form,
          maxRedirects: 0,
        });
      assert.equal(result.status(), 303, "Local-copy cleanup failed");
    }
  }
  return { ...report, restoredExistingFields: true, productionSso: false };
}

export async function embeddedGuestbookWorkflow(page, origin, username) {
  await page.goto(origin + "/u/" + username);
  const parentUrl = page.url();
  const embed = page.locator('iframe[src*="guestbook"]').first();
  const bounds = await embed.boundingBox();
  if (!bounds || bounds.width === 0 || bounds.height === 0) {
    return {
      embedded: true,
      interaction: "unavailable-in-saved-layout",
      width: bounds?.width ?? 0,
      height: bounds?.height ?? 0,
    };
  }
  const frame = page.frameLocator('iframe[src*="guestbook"]').first();
  const ids = () =>
    frame
      .locator(".gb-entry")
      .evaluateAll((entries) => entries.map((entry) => entry.id));
  const timeOrigin = await frame
    .locator("body")
    .evaluate(() => performance.timeOrigin);
  const before = await ids(),
    message = "Isolated embedded guestbook check " + Date.now();
  await frame.locator('textarea[name="message"]').fill(message);
  await frame.getByRole("button", { name: "sign", exact: true }).click();
  const added = frame.locator(".gb-entry").filter({ hasText: message });
  await added.waitFor();
  assert.equal(page.url(), parentUrl);
  assert.equal(
    await frame.locator('textarea[name="message"]').inputValue(),
    "",
  );
  assert.equal((await ids()).length, before.length + 1);
  page.on("dialog", accept);
  try {
    await added.getByRole("button", { name: "x", exact: true }).click();
    await added.waitFor({ state: "detached" });
  } finally {
    page.off("dialog", accept);
  }
  assert.deepEqual(await ids(), before);
  assert.equal(
    await frame.locator("body").evaluate(() => performance.timeOrigin),
    timeOrigin,
    "Enhanced guestbook actions must not reload the iframe",
  );
  return {
    enhancedWithoutIframeReload: true,
    embedded: true,
    parentNavigationPreserved: true,
    signAndReset: true,
    ownerDeletion: true,
    originalEntryIdsPreserved: true,
  };
}
