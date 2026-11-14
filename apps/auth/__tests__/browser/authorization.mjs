import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";

// Real Auth HTTP routes and browser CSP enforcement; only the provider and consumer are fixtures.
const directory = await mkdtemp(`${tmpdir()}/auth-browser-`);
const key = `${directory}/credential.json`;
await writeFile(key, JSON.stringify({ token: "fixture-only" }), {
  mode: 0o600,
});
const enrollmentKey = `${directory}/enrollment.json`;
const enrollmentToken = "fixture-only-enrollment-key".repeat(3);
await writeFile(enrollmentKey, JSON.stringify({ token: enrollmentToken }), {
  mode: 0o600,
});
const applications = JSON.parse(
  await readFile(new URL("../../config/applications.json", import.meta.url)),
);
let callbackOrigin,
  currentClient,
  creationDateOverride,
  delegated = false,
  silent = false,
  promptOverride,
  maxAgeOverride;
let credentialAttempts = 0;
let completions = 0,
  resetCalls = 0,
  silentSuccesses = 0,
  loginRequired = 0;
let holdProfileLookup = false,
  profileLookupEntered,
  releaseProfileLookup;
const provider = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  const json = body ? JSON.parse(body) : {};
  let result;
  if (request.url === "/management/v1/policies/password/complexity") {
    result = {
      policy: {
        minLength: "14",
        hasUppercase: true,
        hasLowercase: true,
        hasNumber: true,
        hasSymbol: true,
      },
    };
  } else if (request.url === "/v2/users/reset-fixture/password") {
    resetCalls++;
    assert.equal(json.verificationCode, "recovery-code");
    if (!/[A-Z]/.test(json.newPassword.password)) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          code: 3,
          message: "Password must contain upper case (DOMAIN-VoaRj)",
        }),
      );
      return;
    }
    if (!/[!@#$%]/.test(json.newPassword.password)) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          code: 3,
          message: "Password must contain symbol (DOMAIN-ZDLwA)",
        }),
      );
      return;
    }
    result = {};
  } else if (request.url.startsWith("/v2/oidc/auth_requests/")) {
    if (request.method === "POST") {
      if (json.error?.error === "ERROR_REASON_LOGIN_REQUIRED") {
        loginRequired++;
        result = {
          callbackUrl: `${callbackOrigin}/callback?error=login_required&state=fixture-state`,
        };
      } else if (
        json.error?.error === "ERROR_REASON_ACCOUNT_SELECTION_REQUIRED"
      )
        result = {
          callbackUrl: `${callbackOrigin}/callback?error=account_selection_required&state=fixture-state`,
        };
      else {
        completions++;
        result = {
          callbackUrl: `${callbackOrigin}/callback?code=fixture-code&state=fixture-state`,
        };
      }
    } else {
      const app = applications.find((a) => a.clientIds.includes(currentClient));
      const scopes = delegated
        ? [
            "openid",
            `urn:zitadel:iam:org:project:id:${app.projectId}:aud`,
            "urn:zitadel:iam:org:projects:roles",
            "urn:zitadel:iam:org:project:role:admin",
            ...(app.id === "ref"
              ? ["urn:zitadel:iam:org:project:role:archive-read"]
              : []),
          ]
        : ["openid"];
      result = {
        authRequest: {
          creationDate: creationDateOverride || new Date().toISOString(),
          clientId: delegated ? "dynamic" : currentClient,
          prompt: promptOverride || (silent ? ["PROMPT_NONE"] : []),
          maxAge: maxAgeOverride,
          redirectUri: `${callbackOrigin}/callback`,
          scope: scopes,
        },
      };
    }
  } else if (request.url === "/v2/sessions/search") result = { sessions: [] };
  else if (request.url === "/v2/sessions" && request.method === "POST") {
    credentialAttempts++;
    if (json.checks.password.password !== "fixture-password") {
      response.writeHead(401);
      response.end("{}");
      return;
    }
    result = { sessionId: "session", sessionToken: "fixture-proof" };
  } else if (request.url === "/v2/sessions/session")
    result = {
      session: {
        factors: {
          user: { id: "fixture-user" },
          password: { verifiedAt: new Date().toISOString() },
        },
        expirationDate: new Date(Date.now() + 600_000).toISOString(),
      },
    };
  else if (request.url === "/management/v1/users/fixture-user") {
    if (holdProfileLookup) {
      holdProfileLookup = false;
      profileLookupEntered();
      await new Promise((resolve) => {
        releaseProfileLookup = resolve;
      });
    }
    result = {
      user: {
        id: "fixture-user",
        state: "USER_STATE_ACTIVE",
        userName: "fixture-user",
        human: { profile: {}, email: { isEmailVerified: true } },
        details: { resourceOwner: "fixture" },
      },
    };
  } else if (request.url === "/management/v1/users/grants/_search") {
    const projectId = json.queries?.find((query) => query.projectIdQuery)
      ?.projectIdQuery.projectId;
    result = {
      result: [
        {
          id: "fixture-grant",
          userId: "fixture-user",
          projectId,
          state: "USER_GRANT_STATE_ACTIVE",
          roleKeys:
            applications.find((app) => app.id === "ref").projectId === projectId
              ? ["admin", "archive-read", "archive-restore"]
              : [
                  applications.some(
                    (app) =>
                      ["marky", "radio"].includes(app.id) &&
                      app.clientIds.includes(currentClient),
                  )
                    ? "member"
                    : "admin",
                ],
        },
      ],
    };
  } else {
    response.writeHead(404);
    response.end("{}");
    return;
  }
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(result));
});
const consumer = createServer((request, response) => {
  const url = new URL(request.url, callbackOrigin);
  if (url.searchParams.get("error") === "login_required") {
    response.setHeader("Content-Type", "text/html");
    response.end("<h1>Signed out portal</h1>");
    return;
  }
  if (url.searchParams.get("error") === "account_selection_required") {
    response.setHeader("Content-Type", "text/html");
    response.end("<h1>Account selection required</h1>");
    return;
  }
  assert.equal(url.searchParams.get("code"), "fixture-code");
  assert.equal(url.searchParams.get("state"), "fixture-state");
  response.setHeader("Content-Type", "text/html");
  response.end("<h1>Consumer session established</h1>");
});
await Promise.all([
  new Promise((r) => provider.listen(0, "127.0.0.1", r)),
  new Promise((r) => consumer.listen(0, "127.0.0.1", r)),
]);
callbackOrigin = `http://127.0.0.1:${consumer.address().port}`;
const reservation = createServer();
await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
const port = reservation.address().port;
await new Promise((r) => reservation.close(r));
const origin = `http://127.0.0.1:${port}`;
const serverOptions = {
  env: {
    ...process.env,
    PORT: String(port),
    PUBLIC_ORIGIN: origin,
    ZITADEL_API_URL: `http://127.0.0.1:${provider.address().port}`,
    LOGIN_TOKEN_FILE: key,
    MANAGEMENT_TOKEN_FILE: key,
    FOURM_ENROLLMENT_KEY_FILE: enrollmentKey,
    RADIO_ENROLLMENT_DB_FILE: `${directory}/radio-memberships.sqlite`,
    ORGANIZATION_ID: "fixture",
    LORE_PROJECT_ID: "fixture",
    LORE_CLIENT_ID: "fixture",
    ADMIN_USER_ID: "fixture-admin",
  },
  stdio: ["ignore", "pipe", "pipe"],
};
let server = spawn(process.execPath, ["src/server.mjs"], serverOptions);
let logs = "";
server.stderr.on("data", (data) => {
  logs += data;
});
let browser;
try {
  await once(server.stdout, "data");
  browser = await chromium.launch();
  const policyContext = await browser.newContext();
  const event = {
    requestId: "request_12345678901234567890",
    subject: "fixture-user",
  };
  const unauthenticatedCompletion = await policyContext.request.post(
    `${origin}/enroll/complete`,
    { data: event },
  );
  assert.equal(unauthenticatedCompletion.status(), 401);
  assert.equal(unauthenticatedCompletion.headers()["set-cookie"], undefined);
  const nominatedProject = await policyContext.request.post(
    `${origin}/enroll/complete`,
    {
      headers: { authorization: `Bearer ${enrollmentToken}` },
      data: { ...event, projectId: "lore" },
    },
  );
  assert.equal(nominatedProject.status(), 400);
  assert.equal(nominatedProject.headers()["set-cookie"], undefined);
  const wrongMethod = await policyContext.request.get(
    `${origin}/enroll/complete`,
  );
  assert.equal(wrongMethod.status(), 405);
  assert.equal(wrongMethod.headers()["set-cookie"], undefined);
  const protectedClient = applications.find((app) => app.id === "fourm")
    .pkceClientIds[0];
  const denied = await policyContext.request.get(
    `${origin}/internal/oidc/authorize-policy`,
    {
      headers: {
        "x-forwarded-uri": `/oauth/v2/authorize?client_id=${protectedClient}&response_type=code`,
        "x-forwarded-method": "GET",
      },
    },
  );
  assert.equal(denied.status(), 400);
  assert.equal(denied.headers()["set-cookie"], undefined);
  const permitted = await policyContext.request.post(
    `${origin}/internal/oidc/authorize-policy`,
    {
      headers: {
        "x-forwarded-uri": "/oauth/v2/authorize",
        "x-forwarded-method": "POST",
        "content-type": "application/x-www-form-urlencoded",
      },
      data: new URLSearchParams({
        client_id: protectedClient,
        response_type: "code",
        code_challenge: "a".repeat(43),
        code_challenge_method: "S256",
      }).toString(),
    },
  );
  assert.equal(permitted.status(), 200);
  assert.equal(permitted.headers()["set-cookie"], undefined);
  const [stagedClient, requestBoundary] = Object.entries(
    applications.find((app) => app.id === "fourm").authRequestNotBefore,
  )[0];
  const stagedPolicy = await policyContext.request.get(
    `${origin}/internal/oidc/authorize-policy`,
    {
      headers: {
        "x-forwarded-uri": `/oauth/v2/authorize?client_id=${stagedClient}&response_type=code`,
        "x-forwarded-method": "GET",
      },
    },
  );
  assert.equal(stagedPolicy.status(), 400);
  assert.equal(
    stagedPolicy.headers()["x-jack-auth-not-before"],
    requestBoundary,
  );
  const lists = applications.find((app) => app.id === "lists");
  if (lists.authorizationHold) {
    currentClient = lists.clientIds[0];
    const held = await policyContext.request.get(
      `${origin}/login?authRequest=held-lists`,
    );
    assert.equal(held.status(), 403);
  }
  assert.equal(completions, 0);
  await policyContext.close();
  const silentContext = await browser.newContext();
  const silentPage = await silentContext.newPage();
  currentClient = applications.find((app) => app.id === "rotund-portal")
    .clientIds[0];
  silent = true;
  const anonymousCredentials = credentialAttempts;
  const anonymousSilent = await silentPage.goto(
    `${origin}/login?authRequest=anonymous-probe`,
  );
  assert.equal(anonymousSilent.status(), 200);
  assert.equal(await silentPage.locator("h1").innerText(), "Signed out portal");
  assert.equal(await silentPage.locator("[name=password]").count(), 0);
  assert.equal(loginRequired, 1);
  assert.equal(credentialAttempts, anonymousCredentials);
  await silentContext.close();
  silent = false;
  // Representative browser boundaries: direct authRequest + login CSP,
  // returnTo + delegated consent, archive scopes, and silent portal sessions.
  // Per-client admission/freshness policy remains covered by the Node tests;
  // this is intentionally not an end-to-end login matrix for every application.
  const enabled = applications.filter(
    (a) =>
      ["fourm", "artbin", "ref", "rotund-portal"].includes(a.id) &&
      !a.authorizationHold,
  );
  for (const app of enabled) {
    currentClient = app.clientIds[0];
    const context = await browser.newContext();
    const page = await context.newPage();
    if (app.authRequestNotBefore?.[currentClient]) {
      creationDateOverride = "2000-01-01T00:00:00Z";
      const stale = await page.goto(`${origin}/login?authRequest=stale`);
      assert.equal(stale.status(), 400);
      creationDateOverride = undefined;
    }
    const firstContext = await browser.newContext();
    const firstPage = await firstContext.newPage();
    const loginResponse = await firstPage.goto(
      `${origin}/login?returnTo=${encodeURIComponent("/authorize?authRequest=first-valid")}`,
    );
    if (app.id === "fourm") {
      const styleNonce = await firstPage
        .locator("style[nonce]")
        .first()
        .evaluate((style) => style.nonce);
      assert(styleNonce);
      const loginCsp = loginResponse.headers()["content-security-policy"];
      assert(loginCsp.includes(`'nonce-${styleNonce}'`));
    }
    await firstPage.locator("[name=username]").fill("fixture-user-" + app.id);
    await firstPage.locator("[name=password]").fill("fixture-password");
    await firstPage
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await firstPage.waitForURL(`${callbackOrigin}/callback?**`, {
      timeout: 5000,
    });
    assert.equal(
      await firstPage.locator("h1").innerText(),
      "Consumer session established",
    );
    await firstContext.close();
    const violations = [];
    page.on("console", (message) => {
      if (message.text().includes("Content Security Policy"))
        violations.push(message.text());
    });
    await page.goto(
      app.id === "fourm"
        ? `${origin}/login?authRequest=fixture`
        : `${origin}/login?returnTo=${encodeURIComponent("/authorize?authRequest=fixture")}`,
    );
    await page.locator("[name=username]").fill("fixture-user-" + app.id);
    await page.locator("[name=password]").fill("wrong");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    assert.match(
      await page.locator("[role=alert]").innerText(),
      /Sign-in failed/,
    );
    await page.locator("[name=username]").fill("fixture-user-" + app.id);
    await page.locator("[name=password]").fill("fixture-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page
      .waitForURL(`${callbackOrigin}/callback?**`, { timeout: 5000 })
      .catch(async (error) => {
        console.error(await page.locator("body").innerText(), violations);
        throw error;
      });
    assert.equal(
      await page.locator("h1").innerText(),
      "Consumer session established",
    );
    // Existing central session must resume without another credential form.
    await page.goto(`${origin}/login?authRequest=second`);
    await page
      .waitForURL(`${callbackOrigin}/callback?**`, { timeout: 5000 })
      .catch(async (error) => {
        console.error(await page.locator("body").innerText(), violations);
        throw error;
      });
    assert.deepEqual(violations, []);
    if (app.id === "rotund-portal") {
      silent = true;
      await page.goto(`${origin}/login?authRequest=existing-session-probe`);
      await page.waitForURL(`${callbackOrigin}/callback?**`, { timeout: 5000 });
      assert.equal(
        await page.locator("h1").innerText(),
        "Consumer session established",
      );
      silentSuccesses++;
      silent = false;
    }
    if (["artbin", "ref"].includes(app.id)) {
      delegated = true;
      if (app.delegatedAuthRequestNotBefore) {
        creationDateOverride = "2000-01-01T00:00:00Z";
        assert.equal(
          (
            await page.goto(`${origin}/login?authRequest=stale-delegated`)
          ).status(),
          400,
        );
        creationDateOverride = undefined;
      }
      const consentResponse = await page.goto(
        `${origin}/login?authRequest=consent`,
      );
      const consentNonce = await page
        .locator("style[nonce]")
        .first()
        .evaluate((style) => style.nonce);
      assert(consentNonce);
      const consentCsp = consentResponse.headers()["content-security-policy"];
      assert(consentCsp.includes(`'nonce-${consentNonce}'`));
      await page.getByRole("button", { name: "Allow", exact: true }).click();
      await page
        .waitForURL(`${callbackOrigin}/callback?**`, { timeout: 5000 })
        .catch(async (error) => {
          console.error(await page.locator("body").innerText(), violations);
          throw error;
        });
      assert.deepEqual(violations, []);
      delegated = false;
    }
    await context.close();
    console.log(
      `PASS ${app.id}: first-valid login, failed-login retry and existing-session callback`,
    );
  }
  currentClient = applications.find((app) => app.id === "artbin").clientIds[0];
  const beforeFreshness = completions;
  const freshnessContext = await browser.newContext();
  const freshnessPage = await freshnessContext.newPage();
  await freshnessPage.goto(`${origin}/login?authRequest=freshness-first`);
  await freshnessPage.locator("[name=username]").fill("fixture-user-artbin");
  await freshnessPage.locator("[name=password]").fill("fixture-password");
  await freshnessPage
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await freshnessPage.waitForURL(`${callbackOrigin}/callback?**`, {
    timeout: 5000,
  });
  promptOverride = ["PROMPT_LOGIN"];
  creationDateOverride = new Date().toISOString();
  await freshnessPage.goto(`${origin}/login?authRequest=force-relogin`);
  assert.equal(await freshnessPage.locator("[name=password]").count(), 1);
  await freshnessPage.locator("[name=username]").fill("fixture-user-artbin");
  await freshnessPage.locator("[name=password]").fill("fixture-password");
  await freshnessPage
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await freshnessPage.waitForURL(`${callbackOrigin}/callback?**`, {
    timeout: 5000,
  });
  promptOverride = [];
  maxAgeOverride = "0s";
  creationDateOverride = new Date().toISOString();
  await freshnessPage.goto(`${origin}/login?authRequest=max-age-zero`);
  assert.equal(await freshnessPage.locator("[name=password]").count(), 1);
  await freshnessPage.locator("[name=username]").fill("fixture-user-artbin");
  await freshnessPage.locator("[name=password]").fill("fixture-password");
  await freshnessPage
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await freshnessPage.waitForURL(`${callbackOrigin}/callback?**`, {
    timeout: 5000,
  });
  maxAgeOverride = "60s";
  creationDateOverride = undefined;
  await freshnessPage.goto(`${origin}/login?authRequest=recent-auth`);
  await freshnessPage.waitForURL(`${callbackOrigin}/callback?**`, {
    timeout: 5000,
  });
  const completionsBeforeSelection = completions;
  const credentialsBeforeSelection = credentialAttempts;
  promptOverride = ["PROMPT_SELECT_ACCOUNT"];
  maxAgeOverride = undefined;
  await freshnessPage.goto(`${origin}/login?authRequest=account-selection`);
  await freshnessPage.waitForURL(
    `${callbackOrigin}/callback?error=account_selection_required&**`,
    { timeout: 5000 },
  );
  assert.equal(
    await freshnessPage
      .getByRole("heading", { name: "Account selection required" })
      .count(),
    1,
  );
  assert.equal(completions, completionsBeforeSelection);
  assert.equal(credentialAttempts, credentialsBeforeSelection);
  delegated = true;
  promptOverride = ["PROMPT_NONE"];
  maxAgeOverride = undefined;
  const beforeSilentDirect = { completions, loginRequired };
  await freshnessPage.goto(`${origin}/authorize?authRequest=direct-silent-get`);
  assert.equal(
    await freshnessPage.locator("h1").innerText(),
    "Signed out portal",
  );
  assert.equal(
    await freshnessPage.getByRole("button", { name: "Allow" }).count(),
    0,
  );
  await freshnessPage.goto(`${origin}/login?returnTo=/account`);
  const csrf = await freshnessPage.locator("[name=csrf]").inputValue();
  const directPost = await freshnessContext.request.post(
    `${origin}/authorize`,
    {
      headers: { Origin: origin },
      form: { authRequest: "direct-silent-post", decision: "approve", csrf },
      maxRedirects: 0,
    },
  );
  assert.equal(directPost.status(), 303);
  const silentDestination = new URL(directPost.headers().location);
  assert.equal(silentDestination.origin, callbackOrigin);
  assert.equal(silentDestination.searchParams.get("error"), "login_required");
  assert.equal(completions, beforeSilentDirect.completions);
  assert.equal(loginRequired, beforeSilentDirect.loginRequired + 2);
  delegated = false;
  await freshnessContext.close();
  assert.equal(completions - beforeFreshness, 4);
  promptOverride = maxAgeOverride = undefined;
  currentClient = applications.find((app) => app.id === "artbin").clientIds[0];
  const staleContext = await browser.newContext();
  const stalePage = await staleContext.newPage();
  const staleReturn = "/authorize?authRequest=restart-form";
  await stalePage.goto(
    `${origin}/login?returnTo=${encodeURIComponent(staleReturn)}`,
  );
  const cookieBeforeRestart = (await staleContext.cookies(origin)).find(
    (cookie) => cookie.name === "__Host-jack_auth",
  );
  assert(
    cookieBeforeRestart?.secure &&
      cookieBeforeRestart.httpOnly &&
      cookieBeforeRestart.sameSite === "Lax",
  );
  const csrfBeforeRestart = await stalePage.locator("[name=csrf]").inputValue();
  const attemptsBeforeRestart = credentialAttempts;
  server.kill();
  await once(server, "exit");
  server = spawn(process.execPath, ["src/server.mjs"], serverOptions);
  server.stderr.on("data", (data) => {
    logs += data;
  });
  await once(server.stdout, "data");
  await stalePage.locator("[name=username]").fill("fixture-user-artbin");
  await stalePage.locator("[name=password]").fill("fixture-password");
  const rejectedResponse = stalePage.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/login",
  );
  await stalePage.getByRole("button", { name: "Sign in", exact: true }).click();
  const rejected = await rejectedResponse;
  assert.equal(rejected.status(), 403);
  assert.equal((await rejected.request().allHeaders()).origin, origin);
  assert.equal(credentialAttempts, attemptsBeforeRestart);
  assert.equal(await stalePage.locator("[name=password]").count(), 1);
  assert.equal(await stalePage.locator("[name=password]").inputValue(), "");
  assert.notEqual(
    await stalePage.locator("[name=csrf]").inputValue(),
    csrfBeforeRestart,
  );
  const recoveredCookie = (await staleContext.cookies(origin)).find(
    (cookie) => cookie.name === "__Host-jack_auth",
  );
  assert(
    recoveredCookie?.secure &&
      recoveredCookie.httpOnly &&
      recoveredCookie.sameSite === "Lax",
  );
  assert.notEqual(recoveredCookie.value, cookieBeforeRestart.value);
  assert.equal(
    await stalePage.locator("[name=returnTo]").inputValue(),
    staleReturn,
  );
  await stalePage.locator("[name=username]").fill("fixture-user-artbin");
  await stalePage.locator("[name=password]").fill("fixture-password");
  await stalePage.getByRole("button", { name: "Sign in", exact: true }).click();
  await stalePage.waitForURL(`${callbackOrigin}/callback?**`, {
    timeout: 5000,
  });
  assert.equal(credentialAttempts, attemptsBeforeRestart + 1);
  const deviceCodePage = await stalePage.goto(`${origin}/device`);
  assert.equal(deviceCodePage.status(), 200);
  assert.equal(
    await stalePage.getByRole("heading", { name: "Device code" }).count(),
    1,
  );
  assert.equal(await stalePage.locator('[name="user_code"]').count(), 1);
  await stalePage.goto(`${origin}/login?returnTo=/account`);
  const signedInCookie = (await staleContext.cookies(origin)).find(
    (cookie) => cookie.name === "__Host-jack_auth",
  )?.value;
  const signedInCsrf = await stalePage.locator("[name=csrf]").inputValue();
  const beforeSignedInReject = credentialAttempts;
  const signedInReject = await staleContext.request.post(`${origin}/login`, {
    headers: {
      Origin: origin,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    data: "csrf=expired&returnTo=%2Faccount&username=fixture-user-artbin&password=fixture-password",
  });
  assert.equal(signedInReject.status(), 403);
  const recoveredSignedInForm = await signedInReject.text();
  assert.match(recoveredSignedInForm, /This form expired/);
  await stalePage.setContent(recoveredSignedInForm);
  assert.equal(await stalePage.locator('form[action="/login"]').count(), 1);
  assert.equal(await stalePage.locator("[name=password]").inputValue(), "");
  assert.equal(
    await stalePage.locator("[name=csrf]").inputValue(),
    signedInCsrf,
  );
  assert.equal(
    await stalePage.locator("[name=returnTo]").inputValue(),
    "/account",
  );
  assert.equal(signedInReject.headers()["set-cookie"], undefined);
  assert.equal(
    (await staleContext.cookies(origin)).find(
      (cookie) => cookie.name === "__Host-jack_auth",
    )?.value,
    signedInCookie,
  );
  assert.equal(credentialAttempts, beforeSignedInReject);
  const waitingForProfile = new Promise((resolve) => {
    profileLookupEntered = resolve;
  });
  holdProfileLookup = true;
  const slowAccount = staleContext.request.get(`${origin}/account`);
  await waitingForProfile;
  await stalePage.locator("[name=username]").fill("fixture-user-artbin");
  await stalePage.locator("[name=password]").fill("fixture-password");
  await stalePage.getByRole("button", { name: "Sign in", exact: true }).click();
  await stalePage.waitForURL(`${origin}/account`, { timeout: 5000 });
  const rotatedCookie = (await staleContext.cookies(origin)).find(
    (cookie) => cookie.name === "__Host-jack_auth",
  )?.value;
  assert(rotatedCookie && rotatedCookie !== signedInCookie);
  releaseProfileLookup();
  const delayedResponse = await slowAccount;
  assert.equal(delayedResponse.status(), 200);
  assert.equal(delayedResponse.headers()["set-cookie"], undefined);
  assert.equal(
    (await staleContext.cookies(origin)).find(
      (cookie) => cookie.name === "__Host-jack_auth",
    )?.value,
    rotatedCookie,
  );
  await staleContext.close();
  console.log(
    "LOGIN_DIAGNOSTIC " +
      JSON.stringify({
        freshFirstSubmissionApps: enabled.length,
        staleFormRepro: "Auth process restart",
        browserOriginMatches: true,
        secureHttpOnlyLaxBeforeAndAfter: true,
        oldCookieAndCsrfReplaced: true,
        rejectedStatus: 403,
        credentialCallsOnRejectedPost: 0,
        blankPassword: true,
        consumerIntentPreserved: true,
        explicitRetryCallback: true,
        productionCredentialsOrSessions: false,
      }),
  );
  console.log(
    "PASS stale login form: strict403 without native credentials, fresh blank form preserves consumer intent, retry callback",
  );
  assert.equal(
    completions,
    5 +
      enabled.length * 3 +
      enabled.filter((app) => ["artbin", "ref"].includes(app.id)).length +
      silentSuccesses,
  );
  const resetContext = await browser.newContext();
  const resetPage = await resetContext.newPage();
  await resetPage.goto(
    `${origin}/reset-password?userID=reset-fixture&code=recovery-code`,
  );
  assert.equal(new URL(resetPage.url()).search, "");
  assert.match(
    await resetPage.locator("#password-requirements").innerText(),
    /14–200 characters; include an uppercase letter, a lowercase letter, a number, a symbol/,
  );
  await resetPage.locator("[name=password]").fill("lowercasepassword123!");
  await resetPage.locator("[name=confirmation]").fill("lowercasepassword123!");
  await resetPage
    .getByRole("button", { name: "Save password", exact: true })
    .click();
  assert.match(
    await resetPage.locator("[role=alert]").innerText(),
    /Include an uppercase letter/,
  );
  assert.equal(await resetPage.locator("[name=password]").inputValue(), "");
  assert.equal(await resetPage.locator("[name=confirmation]").inputValue(), "");
  assert.equal(resetCalls, 1);
  await resetPage.locator("[name=password]").fill("ValidPassword123");
  await resetPage.locator("[name=confirmation]").fill("ValidPassword123");
  await resetPage
    .getByRole("button", { name: "Save password", exact: true })
    .click();
  assert.match(
    await resetPage.locator("[role=alert]").innerText(),
    /Include a symbol/,
  );
  assert.equal(resetCalls, 2);
  await resetPage.locator("[name=password]").fill("ValidPassword123!");
  await resetPage.locator("[name=confirmation]").fill("DifferentPassword123!");
  await resetPage
    .getByRole("button", { name: "Save password", exact: true })
    .click();
  assert.match(
    await resetPage.locator("[role=alert]").innerText(),
    /passwords do not match/,
  );
  assert.equal(resetCalls, 2);
  await resetPage.locator("[name=password]").fill("ValidPassword123!");
  await resetPage.locator("[name=confirmation]").fill("ValidPassword123!");
  await resetPage
    .getByRole("button", { name: "Save password", exact: true })
    .click();
  assert.equal(await resetPage.locator("h1").innerText(), "Password updated");
  assert.equal(resetCalls, 3);
  await resetContext.close();
  console.log(
    "PASS reset: live policy hints, safe validation retry, mismatch, and successful proof-bound submission",
  );
} finally {
  await browser?.close();
  server.kill();
  await once(server, "exit");
  await Promise.all([
    new Promise((r) => provider.close(r)),
    new Promise((r) => consumer.close(r)),
  ]);
  await rm(directory, { recursive: true, force: true });
  if (logs) process.stderr.write(logs);
}
