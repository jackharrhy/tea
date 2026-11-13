import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const same = (actual, expected) =>
  assert.equal(
    digest(actual),
    digest(expected),
    "Widget value differs; hashes only",
  );
async function section(page, title) {
  const details = page
    .locator("details")
    .filter({ has: page.locator("summary").getByText(title, { exact: true }) });
  if ((await details.getAttribute("open")) === null)
    await details.locator("summary").first().click();
  return details;
}
async function edit(page, form, name, value, diagnosticPath) {
  const textarea = form.locator(`textarea[name="${name}"]`);
  const editor = textarea
    .locator("xpath=preceding-sibling::*[1]")
    .locator(".cm-content");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(value);
  const actual = await textarea.inputValue();
  if (digest(actual) !== digest(value)) {
    let first = 0;
    while (
      first < Math.min(actual.length, value.length) &&
      actual[first] === value[first]
    )
      first++;
    await writeFile(
      diagnosticPath,
      JSON.stringify(
        {
          field: name,
          actualLength: actual.length,
          expectedLength: value.length,
          firstMismatch: first,
          actualLines: actual.split("\n").length,
          expectedLines: value.split("\n").length,
          sameAfterTrim: actual.trim() === value.trim(),
          sameAfterLF:
            actual.replaceAll("\r\n", "\n") === value.replaceAll("\r\n", "\n"),
          editorTextLength: (await editor.innerText()).length,
          activeClass: await page.evaluate(
            () => document.activeElement?.className,
          ),
        },
        null,
        2,
      ) + "\n",
    );
  }
  same(actual, value);
}
export async function exerciseWidgetCopies({
  page,
  context,
  origin,
  name,
  output,
  restart,
}) {
  await page.goto(origin + "/settings");
  const username = await page
    .locator('form[action="/settings/username"] input[name="username"]')
    .inputValue();
  const widgets = [
    { kind: "counter", title: "visitor counter", button: "save counter" },
    { kind: "status", title: "status / mood", button: "save status" },
    { kind: "player", title: "music player", button: "save player styling" },
  ];
  const saved = [];
  const playlistBefore = await (
    await context.request.get(origin + `/u/${username}/player`, {
      headers: { Accept: "application/json" },
    })
  ).json();
  for (const widget of widgets) {
    await page.goto(origin + "/settings");
    await section(page, widget.title);
    const form = page.locator(`form[action="/settings/${widget.kind}"]`),
      cssName = widget.kind + "_css",
      htmlName = widget.kind + "_html",
      marker = "fourm-copy-" + widget.kind;
    const originalCSS = await form.locator(`[name="${cssName}"]`).inputValue();
    const originalHTML = await form
      .locator(`[name="${htmlName}"]`)
      .inputValue();
    const css = [originalCSS, `#${marker} { color: rgb(12, 34, 56); }`]
      .filter(Boolean)
      .join("\n");
    const html = [
      originalHTML,
      `<span id="${marker}">isolated widget check</span>`,
    ]
      .filter(Boolean)
      .join("\n");
    await edit(
      page,
      form,
      cssName,
      css,
      `${output}/${name}-editor-diagnostic.json`,
    );
    await edit(
      page,
      form,
      htmlName,
      html,
      `${output}/${name}-editor-diagnostic.json`,
    );
    if (widget.kind === "status") {
      await form.locator('[name="status_emoji"]').fill("☀");
      await form
        .locator('[name="status_text"]')
        .fill("Isolated widget copy check");
    }
    await form
      .getByRole("button", { name: widget.button, exact: true })
      .click();
    await form.locator(`#${widget.kind}-status .ok`).waitFor();
    saved.push({ ...widget, cssName, htmlName, css, html, marker });
  }
  await restart(name);
  for (const widget of saved) {
    await page.goto(origin + "/settings");
    const details = await section(page, widget.title);
    same(
      await details.locator(`[name="${widget.cssName}"]`).inputValue(),
      widget.css,
    );
    same(
      await details.locator(`[name="${widget.htmlName}"]`).inputValue(),
      widget.html,
    );
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await details.screenshot({
        path: `${output}/${name}-${widget.kind}-settings-${width}.png`,
      });
    }
    for (const width of [300, 390]) {
      await page.setViewportSize({ width, height: 200 });
      await page.goto(
        origin + `/u/${encodeURIComponent(username)}/${widget.kind}`,
      );
      await page.locator("#" + widget.marker).waitFor();
      assert.equal(
        await page
          .locator("#" + widget.marker)
          .evaluate((el) => getComputedStyle(el).color),
        "rgb(12, 34, 56)",
      );
      await page.screenshot({
        path: `${output}/${name}-${widget.kind}-widget-${width}.png`,
        fullPage: true,
      });
    }
  }
  const status = await (
    await context.request.get(origin + `/u/${username}/status`, {
      headers: { Accept: "application/json" },
    })
  ).json();
  assert.equal(status.status_text, "Isolated widget copy check");
  assert.equal(status.status_emoji, "☀");
  const counter = await (
    await context.request.get(origin + `/u/${username}/counter`, {
      headers: { Accept: "application/json" },
    })
  ).json();
  assert.equal(typeof counter.total_views, "number");
  const playlistAfter = await (
    await context.request.get(origin + `/u/${username}/player`, {
      headers: { Accept: "application/json" },
    })
  ).json();
  same(playlistAfter, playlistBefore);
  await writeFile(
    `${output}/${name}-widget-acceptance.json`,
    JSON.stringify(
      {
        status: "PASS",
        widgets: 3,
        saveReopen: true,
        coldRestart: true,
        customCSSHTMLRendered: true,
        statusJSON: true,
        counterJSON: true,
        playlistUnchanged: true,
        fixtureAuthentication: true,
        productionTouched: false,
      },
      null,
      2,
    ) + "\n",
  );
}
