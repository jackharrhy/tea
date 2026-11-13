import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, cp, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";

const directory = await mkdtemp(`${tmpdir()}/radio-browser-`);
await cp(new URL("../../src/", import.meta.url), `${directory}/src`, {
  recursive: true,
});
await cp(
  new URL("../../tsconfig.json", import.meta.url),
  `${directory}/tsconfig.json`,
);
await symlink(
  new URL("../../../../node_modules/", import.meta.url).pathname,
  `${directory}/node_modules`,
);
await symlink(
  new URL("../../public/", import.meta.url).pathname,
  `${directory}/public`,
);
await writeFile(`${directory}/package.json`, '{"type":"module"}');
await import("node:fs/promises").then((fs) => fs.mkdir(`${directory}/config`));
const app = {
  id: "radio",
  name: "Radio",
  projectId: "radio-project",
  clientIds: ["radio-client"],
  roles: ["member", "admin"],
  selfEnrollment: "verified-organization-human",
  clientRoleRequirements: { "radio-client": ["member", "admin"] },
};
await writeFile(`${directory}/config/applications.json`, JSON.stringify([app]));
await writeFile(
  `${directory}/config/integrations.json`,
  JSON.stringify({ checkedAt: "synthetic", projects: [], applications: [] }),
);
await writeFile(
  `${directory}/config/services.json`,
  JSON.stringify([
    {
      id: "radio",
      name: "Radio",
      applicationId: "radio",
      kind: "join",
      roles: ["member", "admin"],
      url: "http://radio.test",
      category: "Media",
    },
  ]),
);
await writeFile(`${directory}/key.json`, '{"token":"fixture-only"}', {
  mode: 0o600,
});
let grants = [],
  writes = 0,
  callbacks = 0,
  consumerOrigin;
const provider = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  const data = body ? JSON.parse(body) : {};
  let value;
  if (request.url.startsWith("/v2/oidc/auth_requests/")) {
    if (request.method === "POST") {
      callbacks++;
      value = {
        callbackUrl: `${consumerOrigin}/callback?code=fixture&state=fixture`,
      };
    } else
      value = {
        authRequest: {
          clientId: "radio-client",
          redirectUri: `${consumerOrigin}/callback`,
          scope: ["openid", "profile"],
          creationDate: new Date().toISOString(),
        },
      };
  } else if (request.url === "/v2/sessions" && request.method === "POST")
    value = { sessionId: "proof", sessionToken: "fixture-proof" };
  else if (request.url === "/v2/sessions/proof")
    value = {
      session: {
        factors: {
          user: { id: "person" },
          password: { verifiedAt: new Date().toISOString() },
        },
        expirationDate: new Date(Date.now() + 600000).toISOString(),
      },
    };
  else if (request.url === "/management/v1/users/person")
    value = {
      user: {
        id: "person",
        state: "USER_STATE_ACTIVE",
        userName: "person",
        human: { profile: {}, email: { isEmailVerified: true } },
        details: { resourceOwner: "org" },
      },
    };
  else if (request.url === "/management/v1/users/grants/_search")
    value = { result: grants };
  else if (
    request.url === "/management/v1/users/person/grants" &&
    request.method === "POST"
  ) {
    assert.deepEqual(data, { projectId: app.projectId, roleKeys: ["member"] });
    writes++;
    grants = [
      {
        id: "fixture-grant",
        projectId: app.projectId,
        userId: "person",
        state: "USER_GRANT_STATE_ACTIVE",
        roleKeys: ["member"],
      },
    ];
    value = { userGrantId: "fixture-grant" };
  } else {
    response.writeHead(404);
    response.end("{}");
    return;
  }
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(value));
});
const consumer = createServer((request, response) => {
  assert.equal(
    new URL(request.url, consumerOrigin).searchParams.get("code"),
    "fixture",
  );
  assert.equal(grants[0]?.roleKeys[0], "member");
  response.setHeader("content-type", "text/html");
  response.end("<h1>Radio member callback</h1>");
});
await Promise.all([
  new Promise((r) => provider.listen(0, "127.0.0.1", r)),
  new Promise((r) => consumer.listen(0, "127.0.0.1", r)),
]);
consumerOrigin = `http://127.0.0.1:${consumer.address().port}`;
const reservation = createServer();
await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
const port = reservation.address().port;
await new Promise((r) => reservation.close(r));
const origin = `http://127.0.0.1:${port}`;
let server, browser;
async function start() {
  server = spawn(process.execPath, [`${directory}/src/server.mjs`], {
    env: {
      ...process.env,
      PORT: String(port),
      PUBLIC_ORIGIN: origin,
      ZITADEL_API_URL: `http://127.0.0.1:${provider.address().port}`,
      LOGIN_TOKEN_FILE: `${directory}/key.json`,
      MANAGEMENT_TOKEN_FILE: `${directory}/key.json`,
      ORGANIZATION_ID: "org",
      LORE_PROJECT_ID: "unused",
      LORE_CLIENT_ID: "unused",
      ADMIN_USER_ID: "operator",
      RADIO_ENROLLMENT_DB_FILE: `${directory}/membership.sqlite`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await once(server.stdout, "data");
}
async function stop() {
  server.kill();
  await once(server, "exit");
  server = null;
}
async function login(page, id) {
  await page.goto(`${origin}/login?authRequest=${id}`);
  await page.locator("[name=username]").fill("person");
  await page.locator("[name=password]").fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
try {
  await start();
  browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const security = [];
  page.on("console", (m) => {
    if (m.text().includes("Content Security Policy")) security.push(m.text());
  });
  await login(page, "first");
  assert.equal(await page.locator("h1").innerText(), "Join Radio?");
  assert.equal(writes, 0);
  assert.match(await page.locator("body").innerText(), /upload tracks/);
  const rejected = await context.request.post(`${origin}/authorize`, {
    headers: { origin: "https://wrong.example" },
    form: { authRequest: "first", decision: "approve", csrf: "wrong" },
  });
  assert.equal(rejected.status(), 403);
  assert.equal(writes, 0);
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  await page.waitForURL(`${consumerOrigin}/callback?**`);
  assert.equal(writes, 1);
  await page.goto(`${origin}/login?authRequest=returning`);
  await page.waitForURL(`${consumerOrigin}/callback?**`);
  assert.equal(writes, 1);
  assert.equal(callbacks, 2);
  assert.deepEqual(security, []);
  await context.close();
  grants = [];
  await stop();
  await start();
  const revoked = await browser.newContext();
  const denied = await revoked.newPage();
  await login(denied, "removed");
  assert.match(
    await denied.locator("body").innerText(),
    /membership is unavailable/,
  );
  assert.equal(writes, 1);
  assert.equal(callbacks, 2);
  await revoked.close();
  console.log(
    "PASS Radio actual HTTP/Chromium: explicit Join, no GET grant, forged Origin403, member callback, returning SSO, durable removal denial after restart",
  );
} finally {
  await browser?.close();
  if (server) await stop();
  await Promise.all([
    new Promise((r) => provider.close(r)),
    new Promise((r) => consumer.close(r)),
  ]);
  await rm(directory, { recursive: true, force: true });
}
