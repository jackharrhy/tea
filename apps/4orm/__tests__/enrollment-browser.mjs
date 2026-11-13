import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { setTimeout as delay } from "node:timers/promises";

export async function createInvite(
  origin,
  { adminUsername = "jane", issuer, browserOptions = {} } = {},
) {
  const browser = await chromium.launch(browserOptions);
  try {
    const context = await browser.newContext();
    if (issuer)
      await context.route("**/*", (route) =>
        [origin, issuer].includes(new URL(route.request().url()).origin)
          ? route.continue()
          : route.abort(),
      );
    const page = await context.newPage();
    await page.goto(origin + "/auth/start");
    await page
      .getByRole("button", { name: "Continue as local user", exact: true })
      .click();
    await page.waitForURL(origin + "/u/" + adminUsername, {
      waitUntil: "domcontentloaded",
    });
    await page.goto(origin + "/settings");
    await page
      .locator("summary")
      .filter({ hasText: /^invites$/ })
      .click();
    const before = await page
      .locator("#invites-section code")
      .allTextContents();
    await page
      .getByRole("button", { name: "create invite", exact: true })
      .click();
    await page.waitForFunction(
      (previous) =>
        [...document.querySelectorAll("#invites-section code")].some(
          (node) => !previous.includes(node.textContent),
        ),
      before,
    );
    const code = (
      await page.locator("#invites-section code").allTextContents()
    ).find((value) => !before.includes(value));
    assert.ok(code);
    return { code, adminState: await context.storageState() };
  } finally {
    await browser.close();
  }
}
export async function completeInvite({
  origin,
  issuer,
  key,
  invite,
  output,
  memberUsername = "alex",
  baselineMembers = 2,
  browserOptions = {},
}) {
  const browser = await chromium.launch(browserOptions);
  const headers = { Authorization: "Bearer " + key };
  const endpoint = (path, body) =>
    fetch(origin + path, {
      method: body ? "POST" : "GET",
      headers: { ...headers, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  let requestId;
  try {
    const context = await browser.newContext();
    await context.route("**/*", (route) =>
      [origin, issuer].includes(new URL(route.request().url()).origin)
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", () => errors.push("browser error"));
    await page.goto(origin + "/register?invite=" + invite.code);
    await page
      .getByRole("button", { name: "Continue to Jack Auth", exact: true })
      .click();
    const ticket = new URL(page.url()).searchParams.get("ticket");
    assert.ok(ticket);
    requestId = JSON.parse(
      Buffer.from(ticket.split(".")[0], "base64url").toString(),
    ).requestId;
    const proofPath = `/internal/auth/enrollments/${requestId}/completion`;
    assert.equal((await endpoint(proofPath)).status, 409);
    assert.equal(
      (await fetch(origin + "/world/community").then((r) => r.json())).members
        .length,
      baselineMembers,
    );
    await page
      .getByRole("button", {
        name: "Verify local identity and continue",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Continue as local user", exact: true })
      .waitFor();
    assert.equal(
      (await endpoint(proofPath)).status,
      409,
      "A claimed identity is not a committed profile",
    );
    await page
      .getByRole("button", { name: "Continue as local user", exact: true })
      .click();
    await page.waitForURL(origin + "/trust-agreement");
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "Continue to 4orm", exact: true })
      .click();
    await page.waitForURL(origin + "/u/" + memberUsername);
    assert.equal(
      await page.getByRole("link", { name: "admin", exact: true }).count(),
      0,
      "Central role must not silently make a local member admin",
    );
    assert.equal((await context.request.get(origin + "/admin")).status(), 403);
    const proof = await endpoint(proofPath).then((r) => r.json());
    assert.equal(proof.completed, true);
    assert.equal(proof.createdProfile, true);
    assert.equal(proof.enabled, true);
    assert.equal(proof.subject, "fourm-fixture-" + memberUsername);
    let grantState;
    for (let i = 0; i < 50; i++) {
      grantState = await fetch(issuer + "/fixture/grants", { headers }).then(
        (response) => response.json(),
      );
      if (grantState.completedRequests.includes(requestId)) break;
      await delay(100);
    }
    assert.ok(grantState.completedRequests.includes(requestId));
    for (const application of ["maps", "burger"]) {
      let receipt;
      for (let i = 0; i < 50; i++) {
        receipt = await endpoint(proofPath + `/${application}/reserve`, {
          subject: proof.subject,
          attemptId: "observer-" + application,
        }).then((r) => r.json());
        if (receipt.state === "done") break;
        await delay(100);
      }
      assert.equal(receipt.state, "done");
    }
    assert.equal(grantState.grants, 2);
    assert.deepEqual(grantState.roles, ["member", "member"]);
    const admin = await browser.newContext({ storageState: invite.adminState });
    let retry;
    for (let i = 0; i < 20; i++) {
      const response = await admin.request.post(
        origin + "/admin/enrollment-completions/retry",
        { headers: { Origin: origin } },
      );
      assert.equal(response.status(), 200);
      retry = await response.json();
      if (!retry.outcomes.length) break;
      await delay(100);
    }
    assert.deepEqual(retry.outcomes, []);
    assert.equal(
      (
        await fetch(issuer + "/fixture/delete-grants", {
          method: "POST",
          headers,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(issuer + "/enroll/complete", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ requestId, subject: proof.subject }),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await fetch(issuer + "/fixture/grants", { headers }).then((r) =>
          r.json(),
        )
      ).grants,
      0,
      "Terminal receipts must not recreate removed grants",
    );
    assert.deepEqual(errors, []);
    await page.screenshot({
      path: output + "/enrolled-member.png",
      fullPage: true,
    });
    await admin.close();
    return {
      status: "PASS",
      requestId,
      userId: proof.userId,
      preCallbackProofDenied: true,
      signedCallback: true,
      trustAgreement: true,
      newLocalAdmin: false,
      twoMemberOnlyCompanions: true,
      terminalReplayAfterDeletionCreatesNoGrant: true,
      browserErrors: 0,
      productionTouched: false,
    };
  } finally {
    await browser.close();
  }
}
