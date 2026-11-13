import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { createAccessStore } from "../../src/access-store.mjs";

const directory = await mkdtemp(`${tmpdir()}/auth-management-`);
const applications = JSON.parse(
  readFileSync(new URL("../../config/applications.json", import.meta.url)),
);
const services = JSON.parse(
  readFileSync(new URL("../../config/services.json", import.meta.url)),
);
const maps = applications.find((item) => item.id === "maps"),
  artbin = applications.find((item) => item.id === "artbin");
const users = [
  {
    id: "operator",
    userName: "operator",
    state: "USER_STATE_ACTIVE",
    human: {
      profile: { displayName: "Robin Operator" },
      email: { isEmailVerified: true },
    },
    details: { resourceOwner: "org" },
  },
  {
    id: "member",
    userName: "member",
    state: "USER_STATE_ACTIVE",
    human: {
      profile: { displayName: "Sam Member" },
      email: { isEmailVerified: true },
    },
    details: { resourceOwner: "org" },
  },
];
let grants = [
  {
    id: "owner-maps",
    userId: "operator",
    projectId: maps.projectId,
    state: "USER_GRANT_STATE_ACTIVE",
    roleKeys: ["admin"],
  },
  {
    id: "member-maps",
    userId: "member",
    projectId: maps.projectId,
    state: "USER_GRANT_STATE_ACTIVE",
    roleKeys: ["member", "private-extra"],
  },
];
for (const [id, role] of [
  ["fourm", "member"],
  ["burger", "member"],
  ["lists", "admin"],
  ["ref", "admin"],
  ["media-admin", "admin"],
]) {
  grants.push({
    id: `operator-${id}`,
    userId: "operator",
    projectId: applications.find((item) => item.id === id).projectId,
    state: "USER_GRANT_STATE_ACTIVE",
    roleKeys: [role],
  });
}
let writes = 0;
const sessions = new Map();
const store = createAccessStore({
  filename: `${directory}/access.sqlite`,
  applications,
  services,
  native: {},
});
store.bootstrap({ administrator: "operator", grants });
store.close();
await writeFile(`${directory}/key.json`, '{"token":"synthetic-only"}', {
  mode: 0o600,
});
const provider = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  const data = body ? JSON.parse(body) : {};
  let result;
  const sessionPath =
    request.url === "/v2/sessions/search"
      ? null
      : request.url.match(/^\/v2\/sessions\/([^/]+)$/);
  const userPath = request.url.match(/^\/management\/v1\/users\/([^/]+)$/);
  if (request.url === "/v2/sessions" && request.method === "POST") {
    const user = users.find(
      (candidate) => candidate.userName === data.checks.user.loginName,
    );
    if (!user || data.checks.password.password !== "fixture-password") {
      response.writeHead(401);
      response.end("{}");
      return;
    }
    const id = `session-${sessions.size + 1}`;
    sessions.set(id, {
      id,
      factors: {
        user: { id: user.id },
        password: { verifiedAt: new Date().toISOString() },
      },
      expirationDate: new Date(Date.now() + 600000).toISOString(),
    });
    result = { sessionId: id, sessionToken: "synthetic-proof" };
  } else if (sessionPath && request.method === "DELETE") {
    sessions.delete(sessionPath[1]);
    result = {};
  } else if (sessionPath) {
    result = { session: sessions.get(sessionPath[1]) };
  } else if (request.url === "/v2/sessions/search") {
    const subject = data.queries[0].userIdQuery.id;
    result = {
      sessions: [...sessions.values()].filter(
        (session) => session.factors.user.id === subject,
      ),
    };
  } else if (request.url === "/management/v1/users/_search")
    result = { result: users };
  else if (userPath)
    result = { user: users.find((user) => user.id === userPath[1]) };
  else if (request.url === "/management/v1/users/grants/_search")
    result = {
      result: grants.filter(
        (grant) =>
          !data.queries?.some(
            (query) =>
              query.projectIdQuery &&
              query.projectIdQuery.projectId !== grant.projectId,
          ),
      ),
    };
  else if (
    request.url ===
    "/zitadel.authorization.v2.AuthorizationService/ListAuthorizations"
  ) {
    assert.equal(request.headers["connect-protocol-version"], "1");
    const ids = data.filters?.find((filter) => filter.inUserIds)?.inUserIds.ids;
    result = {
      authorizations: grants
        .filter((grant) => !ids || ids.includes(grant.userId))
        .map((grant) => ({
          id: grant.id,
          organization: { id: "org" },
          project: { id: grant.projectId },
          user: { id: grant.userId },
          state:
            grant.state === "USER_GRANT_STATE_ACTIVE"
              ? "STATE_ACTIVE"
              : "STATE_INACTIVE",
          roles: grant.roleKeys.map((key) => ({ key })),
        })),
    };
  } else if (
    request.url ===
    "/zitadel.authorization.v2.AuthorizationService/CreateAuthorization"
  ) {
    writes++;
    const id = `grant-${writes}`;
    grants.push({
      id,
      userId: data.userId,
      projectId: data.projectId,
      state: "USER_GRANT_STATE_ACTIVE",
      roleKeys: data.roleKeys,
    });
    result = { id };
  } else if (
    request.url ===
    "/zitadel.authorization.v2.AuthorizationService/UpdateAuthorization"
  ) {
    writes++;
    grants.find((grant) => grant.id === data.id).roleKeys = data.roleKeys;
    result = {};
  } else if (
    request.url ===
    "/zitadel.authorization.v2.AuthorizationService/DeleteAuthorization"
  ) {
    writes++;
    grants = grants.filter((grant) => grant.id !== data.id);
    result = {};
  } else {
    response.writeHead(404);
    response.end("{}");
    return;
  }
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(result));
});
await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["src/server.mjs"], {
  env: {
    ...process.env,
    PORT: String(port),
    PUBLIC_ORIGIN: origin,
    ZITADEL_API_URL: `http://127.0.0.1:${provider.address().port}`,
    LOGIN_TOKEN_FILE: `${directory}/key.json`,
    MANAGEMENT_TOKEN_FILE: `${directory}/key.json`,
    ACCESS_DB_FILE: `${directory}/access.sqlite`,
    ORGANIZATION_ID: "org",
    LORE_PROJECT_ID: "unused",
    LORE_CLIENT_ID: "unused",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
server.stderr.on("data", (data) => (logs += data));
let browser;
const snapshots = process.env.AUTH_SCREENSHOT_DIR;
async function capture(page, name) {
  if (snapshots) {
    await mkdir(snapshots, { recursive: true });
    await page.screenshot({ path: `${snapshots}/${name}.png`, fullPage: true });
    await mkdir(`${snapshots}/assets/fonts`, { recursive: true });
    await writeFile(
      `${snapshots}/assets/style.css`,
      readFileSync(new URL("../../src/styles.css", import.meta.url)),
    );
    await writeFile(
      `${snapshots}/assets/fonts/inter-variable.woff2`,
      readFileSync(
        new URL("../../public/fonts/inter-variable.woff2", import.meta.url),
      ),
    );
    await writeFile(`${snapshots}/${name}.html`, await page.content());
  }
}
try {
  await once(server.stdout, "data");
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.name));
  await page.goto(origin + "/login");
  await page.getByRole("heading", { name: "auth", exact: true }).waitFor();
  assert.equal(await page.locator("footer").count(), 0);
  assert.equal(
    await page.getByText("Your account, your apps.", { exact: true }).count(),
    0,
  );
  assert(
    (
      await page
        .locator("h1")
        .evaluate((node) => getComputedStyle(node).fontFamily)
    ).includes("Inter"),
  );
  await capture(page, "login-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, "login-mobile");
  await page.setViewportSize({ width: 768, height: 1024 });
  await capture(page, "login-tablet");
  await page.emulateMedia({ colorScheme: "dark" });
  await capture(page, "login-dark");
  await page.emulateMedia({ colorScheme: "light" });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel("Username or email").fill("operator");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL(origin + "/");
  assert.equal(await page.locator("h1").innerText(), "Your apps");
  await page.getByRole("link", { name: "Worldview", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Apps", exact: true }).waitFor();
  await page.getByRole("heading", { name: "Media", exact: true }).waitFor();
  await page
    .getByRole("heading", { name: "Your tools", exact: true })
    .waitFor();
  await capture(page, "apps-desktop");
  await page.getByRole("link", { name: "Services", exact: true }).first().click();
  await page.getByRole("heading", { name: "Services", exact: true }).waitFor();
  await page.getByRole("link", { name: "Worldview", exact: true }).click();
  await page.getByRole("heading", { name: "Worldview", exact: true }).waitFor();
  await page.getByRole("link", { name: "Services", exact: true }).last().click();
  await page.getByRole("link", { name: "Technical integrations" }).click();
  await page.getByRole("heading", { name: "Technical integrations" }).waitFor();
  await page.getByRole("link", { name: "People", exact: true }).first().click();
  await page.getByRole("link", { name: /Sam Member/ }).click();
  await capture(page, "person-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.getByText("Menu", { exact: true }).click();
  await page
    .locator(".mobile-nav a")
    .filter({ hasText: "Your apps" })
    .waitFor();
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.getByText("Menu", { exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const previewCsrf = await page
    .locator("input[name=csrf]")
    .first()
    .inputValue();
  const beforePreviewWrites = writes;
  await page.getByRole("link", { name: "Preview auth", exact: true }).click();
  await page.getByText("Viewing Sam Member", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("link", { name: "People", exact: true }).count(),
    0,
  );
  assert.equal(await page.locator("form").count(), 0);
  assert.equal(await page.locator('a[href^="https://"]').count(), 0);
  await page
    .getByText("Temporary Auth preview · Read only", { exact: true })
    .waitFor();
  await page
    .getByRole("link", { name: /Access details for/ })
    .first()
    .click();
  await page
    .locator("main")
    .getByRole("link", { name: "Your apps", exact: true })
    .click();
  assert.equal(new URL(page.url()).pathname, "/manage/people/member/preview");
  await capture(page, "user-preview");
  await page.getByRole("link", { name: "Account", exact: true }).click();
  await page.getByRole("heading", { name: "Account", exact: true }).waitFor();
  assert.equal(await page.locator("form").count(), 0);
  const readonly = await context.request.post(
    origin + "/manage/people/member/preview",
    { headers: { origin }, form: { csrf: previewCsrf } },
  );
  assert.equal(readonly.status(), 403);
  assert.equal(writes, beforePreviewWrites);
  await page.getByRole("link", { name: "Exit preview", exact: true }).click();
  await page.getByRole("link", { name: "Groups", exact: true }).first().click();
  await page.getByRole("link", { name: "Create group", exact: true }).click();
  await page.getByLabel("Group name").fill("Cartography collaborators");
  await page
    .getByLabel("Description", { exact: true })
    .fill("Synthetic group for the browser acceptance.");
  await page.locator(`[name=bindings][value="maps|member"]`).check();
  await page.locator('[name=bindings][value="artbin|member"]').check();
  await page
    .getByLabel("Reason", { exact: true })
    .fill("Prove explicit group creation.");
  await page.getByRole("button", { name: "Review group", exact: true }).click();
  assert.equal(writes, 0);
  await page
    .getByRole("button", { name: "Apply reviewed change", exact: true })
    .click();
  assert.equal(writes, 0);
  await page.getByRole("link", { name: "People", exact: true }).first().click();
  await page.getByRole("link", { name: /Sam Member/ }).click();
  const membership = page
    .locator("form")
    .filter({ has: page.locator('[name=type][value="membership.add"]') });
  await membership
    .getByLabel("Add to group")
    .selectOption({ label: "Cartography collaborators" });
  await membership.getByLabel("Reason").fill("Prove one group assignment.");
  await membership.getByRole("button", { name: "Review membership" }).click();
  await capture(page, "review-desktop");
  assert.equal(writes, 0);
  await page.getByRole("button", { name: "Apply reviewed change" }).click();
  assert.equal(writes, 1);
  assert(
    grants.some(
      (grant) =>
        grant.userId === "member" && grant.projectId === artbin.projectId,
    ),
  );
  assert.deepEqual(
    grants.find((grant) => grant.id === "member-maps").roleKeys,
    ["member", "private-extra"],
  );
  await page.goto(origin + "/manage/activity");
  await page.getByRole("heading", { name: "Activity & cleanup" }).waitFor();
  await page.getByRole("link", { name: /Prove one group assignment/ }).click();
  await page.getByRole("heading", { name: "Access operation" }).waitFor();
  await page.getByText("External cleanup", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Groups", exact: true }).first().click();
  await capture(page, "groups-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, "groups-mobile");
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/account/sessions");
  await page.getByRole("heading", { name: "Sessions", exact: true }).waitFor();
  assert.equal(
    await page.getByText("This browser", { exact: true }).count(),
    1,
  );
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await memberPage.goto(origin + "/login");
  await memberPage.getByLabel("Username or email").fill("member");
  await memberPage
    .getByLabel("Password", { exact: true })
    .fill("fixture-password");
  await memberPage
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await memberPage.waitForURL(origin + "/");
  assert.equal(
    await memberPage.getByRole("link", { name: "People", exact: true }).count(),
    0,
  );
  const denied = await memberContext.request.get(origin + "/manage/people");
  assert.equal(denied.status(), 403);
  assert.equal(
    (
      await memberContext.request.get(
        origin + "/manage/people/operator/preview",
      )
    ).status(),
    403,
  );
  const forged = await context.request.post(origin + "/manage/changes/apply", {
    headers: { origin: "https://wrong.example" },
    form: { operation: "made-up", csrf: "wrong" },
  });
  assert.equal(forged.status(), 403);
  assert.deepEqual(errors, []);
  console.log(
    "PASS access UI Chromium: compact login, directory, explicit admin membership, groups preview/apply, native v2 write, overlapping role preservation, sessions, member denial, forged Origin, mobile layout.",
  );
  assert(!logs.includes("SyntaxError"), "Server syntax failure");
  await memberContext.close();
  await context.close();
} finally {
  await browser?.close();
  server.kill();
  await once(server, "exit");
  await new Promise((resolve) => provider.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
