import { test, expect } from "@playwright/test";

test("design reference is public and shows live admin tokens", async ({
  page,
}) => {
  await page.goto("http://operator.localhost:4352/design");
  await expect(
    page.getByRole("heading", { name: "Design", exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-token-value="--accent"]')).not.toBeEmpty();
  await expect(page.getByText("Page list row")).toBeVisible();
  const fields = page.locator(".design-form-sample");
  const inputHeight = await fields
    .locator('input[type="text"]')
    .evaluate((element) => element.getBoundingClientRect().height);
  const select = fields.locator("select");
  expect(
    await select.evaluate((element) => element.getBoundingClientRect().height),
  ).toBe(inputHeight);
  expect(
    await select.evaluate((element) =>
      parseFloat(getComputedStyle(element).paddingRight),
    ),
  ).toBeGreaterThanOrEqual(32);
  const buttons = page.locator(".design-button-row");
  for (const [label, property] of [
    ["Save draft", "backgroundColor"],
    ["Delete", "backgroundColor"],
    ["Text button", "color"],
  ] as const) {
    const button = buttons.getByRole("button", { name: label });
    const before = await button.evaluate(
      (element, key) => getComputedStyle(element)[key],
      property,
    );
    await button.hover();
    await expect
      .poll(() =>
        button.evaluate(
          (element, key) => getComputedStyle(element)[key],
          property,
        ),
      )
      .not.toBe(before);
  }
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() =>
      Array.from(document.fonts).some(
        (font) => font.family === "Inter" && font.status === "loaded",
      ),
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("operator dashboard opens both isolated site editors", async ({
  page,
}) => {
  const origin = "http://operator.localhost:4352";
  await page.goto(origin);
  await expect(page).toHaveURL(origin + "/login");
  await page.getByLabel("Email").fill("operator@example.test");
  await page.getByLabel("Password").fill("operator-fixture-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(origin + "/");
  await expect(page.getByRole("heading", { name: "Sites" })).toBeVisible();
  await expect(page.getByText("Healthy")).toHaveCount(2);
  await page.screenshot({ path: "tmp/operator-dashboard.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "tmp/operator-dashboard-mobile.png",
    fullPage: true,
  });

  await page
    .getByRole("button", { name: "Open Sidebar fixture editor" })
    .click();
  await expect(page).toHaveURL("http://andrew.localhost:4352/tea/admin");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.getByRole("link", { name: "Sites" }).click();
  await expect(page).toHaveURL(origin + "/");
  await page
    .getByRole("button", { name: "Open Portfolio fixture editor" })
    .click();
  await expect(page).toHaveURL("http://luke.localhost:4352/tea/admin");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await page.goto(origin);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(origin + "/login");
  await page.goto("http://andrew.localhost:4352/tea/admin");
  await expect(page).toHaveURL("http://andrew.localhost:4352/tea/login");
});
