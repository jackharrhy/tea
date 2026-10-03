import { test, expect } from "@playwright/test";
import { credentials } from "./fixture.ts";

for (const site of ["andrew", "luke"]) {
  test(`${site}: visual editing saves a draft without publishing`, async ({
    page,
    browser,
  }) => {
    const origin = `http://${site}.localhost:4352`;
    await page.goto(origin + "/tea/login");
    await page.getByLabel("Email address").fill(credentials.email);
    await page
      .getByLabel("Password", { exact: true })
      .fill(credentials.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await page.goto(origin);
    await expect(
      page.getByRole("link", { name: "Edit on site" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Edit on site" }).click();
    await expect(page).toHaveURL(origin + "/?tea_edit=1");
    const response = await page.request.get(origin + "/tea/admin/visual/~");
    expect(response.ok()).toBe(true);
    const { fields, revision } = await response.json();
    expect(fields.length).toBeGreaterThan(0);
    const field = fields[0];
    const target = page.locator(`[data-preview-key="${field.id}"]`);
    await target.click();
    const edited = `Visual draft for ${site}`;
    await page.getByRole("textbox", { name: "Block text" }).fill(edited);
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(target).toHaveText(edited);
    const stale = await page.request.post(origin + "/tea/admin/visual/~", {
      headers: { Origin: origin },
      data: { id: field.id, text: "Stale edit", revision },
    });
    expect(stale.status()).toBe(409);
    await page.reload();
    await expect(page.locator(`[data-preview-key="${field.id}"]`)).toHaveText(
      edited,
    );

    const visitor = await browser.newPage();
    await visitor.goto(origin);
    await expect(visitor.getByText(edited)).toHaveCount(0);
    await expect(visitor.locator("#tea-visual-bar")).toHaveCount(0);
    await visitor.goto(origin + "/?tea_edit=1");
    await expect(visitor.locator("[data-preview-key]")).toHaveCount(0);
    await visitor.close();
  });
}
