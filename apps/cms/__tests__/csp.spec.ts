import { test, expect } from "@playwright/test";
import { credentials } from "./fixture.ts";

test("public, operator, and editor pages run under request CSP", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      message.text().includes("Content Security Policy")
    )
      violations.push(message.text());
  });
  page.on("pageerror", (error) => violations.push(error.message));

  for (const url of [
    "http://andrew.localhost:4352/",
    "http://luke.localhost:4352/",
    "http://operator.localhost:4352/design",
  ]) {
    const response = await page.goto(url);
    const policy = response?.headers()["content-security-policy"];
    const nonce = policy?.match(/'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    expect(response?.headers()["cache-control"]).toContain("no-store");
    expect(await response?.text()).toContain(`nonce="${nonce}"`);
  }

  await page.goto("http://andrew.localhost:4352/tea/login");
  await page.getByLabel("Email address").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL("http://andrew.localhost:4352/tea/admin");
  await expect(page.locator("#workspace")).not.toHaveAttribute("inert", "");
  expect(violations).toEqual([]);
});
