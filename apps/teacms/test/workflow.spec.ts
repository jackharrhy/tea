import { test, expect } from "@playwright/test";
import { credentials } from "./fixture.ts";
for (const site of ["andrew", "luke"]) {
  test(`${site}: native editor, drafts, publishing, settings and feature controls`, async ({
    page,
    browser,
  }) => {
    const origin = `http://${site}.localhost:4352`;
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin + "/tea/login");
    await page.getByLabel("Email address").fill(credentials.email);
    await page
      .getByLabel("Password", { exact: true })
      .fill(credentials.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(origin + "/tea/admin");
    await expect(page.locator("#workspace")).not.toHaveAttribute("inert", "");
    await page.goto(origin + "/tea/admin/homepage");
    await expect(page.locator("#workspace")).not.toHaveAttribute("inert", "");
    const riso = page.getByRole("button", {
      name: "+ Riso colors",
      exact: true,
    });
    if (site === "andrew") await expect(riso).toBeVisible();
    else await expect(riso).toHaveCount(0);
    const fields = page.locator('[contenteditable="true"]');
    await expect(fields.first()).toBeVisible();
    await fields.first().fill(`Edited ${site} heading`);
    if (site === "andrew") await riso.click();
    await expect(
      page.getByText("Draft saved", { exact: true }).first(),
    ).toBeVisible({ timeout: 15000 });
    const visitor = await browser.newPage();
    await visitor.goto(origin);
    await expect(
      visitor.getByRole("heading", { name: `Edited ${site} heading` }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expect(
      page.getByText("Published", { exact: true }).first(),
    ).toBeVisible();
    await visitor.reload();
    await expect(
      visitor.getByRole("heading", { name: `Edited ${site} heading` }),
    ).toBeVisible();
    if (site === "andrew") {
      const ink = visitor
        .getByRole("button", { name: /Copy .+ color/ })
        .first();
      await ink.click();
      await expect(ink).toHaveText(/Copied!|^rgb\(/);
    }
    await visitor.close();
    await page.goto(origin + "/tea/admin/sidebar");
    await expect(page.locator("#workspace")).not.toHaveAttribute("inert", "");
    await page.goto(origin + "/tea/admin/site");
    await expect(page.locator("#workspace")).not.toHaveAttribute("inert", "");
    await page
      .getByLabel("Google Analytics measurement ID")
      .fill("G-FIXTURE123");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(
      page.getByText("Site settings saved.", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByLabel("Google Analytics measurement ID"),
    ).toHaveValue("G-FIXTURE123");
    await page.goto(origin);
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expect(
        page.getByRole("link", { name: "Example page", exact: true }),
      ).toBeVisible({ visible: width === 1440 });
      await page.screenshot({
        path: `tmp/${site}-${width}.png`,
        fullPage: true,
      });
    }
    expect(errors).toEqual([]);
  });
}
