import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBindings, visibleServices } from "../app/services.js";
import { createPortal } from "../app/router.js";

const org = "fixture-org";
const bindings = [
  {
    id: "jellyfin",
    projectId: "fixture-jellyfin",
    requiredAnyRole: ["member"],
  },
  ...["sonarr", "radarr", "prowlarr", "qbittorrent"].map((id) => ({
    id,
    projectId: "fixture-admin",
    requiredAnyRole: ["admin"],
  })),
];
const roles = (project: string, role: string, organization = org) => ({
  [`urn:zitadel:iam:org:project:${project}:roles`]: {
    [role]: { [organization]: "fixture.test" },
  },
});

test("service permissions use exact project, organization and role; no role means no protected link", () => {
  assert.deepEqual(
    visibleServices({}, bindings, org).map((s) => s.id),
    [],
  );
  assert.deepEqual(
    visibleServices(roles("fixture-jellyfin", "member"), bindings, org).map(
      (s) => s.id,
    ),
    ["jellyfin"],
  );
  assert.equal(
    visibleServices(
      {
        ...roles("fixture-jellyfin", "member"),
        ...roles("fixture-admin", "admin"),
      },
      bindings,
      org,
    ).length,
    5,
  );
  for (const claims of [
    roles("fixture-admin", "admin", "wrong-org"),
    roles("wrong-project", "admin"),
    { email: "owner@example.test", name: "Jack", admin: true },
    { "urn:zitadel:iam:org:project:fixture-admin:roles": ["admin"] },
    {
      "urn:zitadel:iam:org:project:fixture-admin:roles": {
        admin: { [org]: true },
      },
    },
  ]) {
    assert.deepEqual(
      visibleServices(claims, bindings, org).map((s) => s.id),
      [],
    );
  }
});

test("optional catalogue bindings preserve existing config and require exact subject for Seerr", () => {
  assert.equal(parseBindings(JSON.stringify(bindings)).length, 5);
  const added = parseBindings(
    JSON.stringify([
      ...bindings,
      {
        id: "navidrome",
        projectId: "fixture-music",
        requiredAnyRole: ["member"],
      },
      {
        id: "seerr",
        projectId: "fixture-seerr",
        requiredAnyRole: ["requester"],
        allowedSubject: "fixture-owner",
      },
    ]),
  );
  const claims = {
    sub: "fixture-owner",
    ...roles("fixture-music", "member"),
    ...roles("fixture-seerr", "requester"),
  };
  assert.deepEqual(
    visibleServices(claims, added, org).map((service) => service.id),
    ["navidrome", "seerr"],
  );
  assert.deepEqual(
    visibleServices({ ...claims, sub: "other-subject" }, added, org).map(
      (service) => service.id,
    ),
    ["navidrome"],
  );
  assert.deepEqual(
    visibleServices(
      { sub: "fixture-owner", ...roles("fixture-music", "member") },
      added,
      org,
    ).map((service) => service.id),
    ["navidrome"],
  );
  assert.throws(() =>
    parseBindings(
      JSON.stringify([
        ...bindings,
        {
          id: "seerr",
          projectId: "fixture-seerr",
          requiredAnyRole: ["requester"],
        },
      ]),
    ),
  );
  assert.throws(() =>
    parseBindings(
      JSON.stringify([
        ...bindings,
        {
          id: "navidrome",
          projectId: "fixture-music",
          requiredAnyRole: ["member"],
        },
        {
          id: "navidrome",
          projectId: "duplicate",
          requiredAnyRole: ["member"],
        },
      ]),
    ),
  );
});

test("Seerr admits existing media members without exposing management links", () => {
  const seerr = { ...bindings[0], id: "seerr" };
  const configured = parseBindings(JSON.stringify([...bindings, seerr]));
  assert.deepEqual(
    visibleServices(
      { sub: "fixture-member", ...roles("fixture-jellyfin", "member") },
      configured,
      org,
    ).map((service) => service.id),
    ["jellyfin", "seerr"],
  );
  for (const claims of [
    {},
    roles("fixture-jellyfin", "member", "wrong-org"),
    roles("wrong-project", "member"),
    roles("fixture-jellyfin", "admin"),
  ])
    assert.equal(
      visibleServices(claims, configured, org).some(
        (service) => service.id === "seerr",
      ),
      false,
    );
  for (const replacement of [
    { ...seerr, projectId: "different-project" },
    { ...seerr, requiredAnyRole: ["admin"] },
  ])
    assert.throws(() =>
      parseBindings(JSON.stringify([...bindings, replacement])),
    );
});

for (const service of [
  {
    id: "cleanuparr",
    name: "Cleanuparr",
    url: "https://cleanuparr.rotund.org/",
  },
  { id: "slskd", name: "slskd (Soulseek)", url: "https://slskd.rotund.org/" },
]) {
  test(`${service.name} is optional and shares the reviewed media-admin entitlement`, async () => {
    assert.equal(
      visibleServices(roles("fixture-admin", "admin"), bindings, org).some(
        (item) => item.id === service.id,
      ),
      false,
    );
    const ownerBindings =
      service.id === "slskd"
        ? bindings
        : bindings.map((binding) =>
            binding.projectId === "fixture-admin"
              ? { ...binding, allowedSubject: "fixture-owner" }
              : binding,
          );
    const binding = {
      id: service.id,
      projectId: "fixture-admin",
      requiredAnyRole: ["admin"],
      allowedSubject: "fixture-owner",
    };
    if (service.id === "slskd") {
      assert.throws(() =>
        parseBindings(
          JSON.stringify([
            ...bindings.map((member) =>
              member.projectId === "fixture-admin"
                ? { ...member, allowedSubject: "different-owner" }
                : member,
            ),
            binding,
          ]),
        ),
      );
    }
    const configured = parseBindings(
      JSON.stringify([...ownerBindings, binding]),
    );
    const claims = { sub: "fixture-owner", ...roles("fixture-admin", "admin") };
    assert.deepEqual(
      visibleServices(claims, configured, org).find(
        (item) => item.id === service.id,
      ),
      service,
    );
    for (const denied of [
      { sub: "other-subject", ...roles("fixture-admin", "admin") },
      { sub: "fixture-owner", ...roles("fixture-jellyfin", "member") },
      { sub: "fixture-owner", ...roles("fixture-admin", "member") },
      { sub: "fixture-owner", ...roles("fixture-admin", "admin", "wrong-org") },
      { sub: "fixture-owner", ...roles("wrong-project", "admin") },
    ]) {
      assert.equal(
        visibleServices(denied, configured, org).some(
          (item) => item.id === service.id,
        ),
        false,
      );
    }
    for (const replacement of [
      { ...binding, projectId: "fixture-jellyfin" },
      { ...binding, requiredAnyRole: ["member"] },
      ...(service.id === "cleanuparr"
        ? [{ ...binding, allowedSubject: "unreviewed-subject" }]
        : []),
    ]) {
      assert.throws(() =>
        parseBindings(JSON.stringify([...ownerBindings, replacement])),
      );
    }
    assert.throws(() =>
      parseBindings(
        JSON.stringify([
          ...ownerBindings.map((member) =>
            member.id === "radarr"
              ? { ...member, requiredAnyRole: ["member"] }
              : member,
          ),
          binding,
        ]),
      ),
    );
    const withoutOwner = JSON.stringify([
      ...bindings,
      { ...binding, allowedSubject: undefined },
    ]);
    if (service.id === "slskd") {
      assert.throws(() => parseBindings(withoutOwner));
    } else {
      assert.doesNotThrow(() => parseBindings(withoutOwner));
    }
    const f = fixture(configured);
    const signed = await signIn(f.app);
    assert.ok(
      (await (await f.app.fetch(request("/", signed))).text()).includes(
        service.url,
      ),
    );
    f.setClaims({
      sub: "fixture-owner",
      ...roles("fixture-jellyfin", "member"),
    });
    assert.ok(
      !(await (await f.app.fetch(request("/", signed))).text()).includes(
        service.url,
      ),
    );
  });
}

function fixture(serviceBindings = bindings) {
  let liveClaims: Record<string, unknown> = {
    sub: "fixture-owner",
    ...roles("fixture-admin", "admin"),
  };
  const identity = {
    begin(tx: { state: string }, silent: boolean) {
      return `https://issuer.test/authorize?state=${tx.state}&prompt=${silent ? "none" : "login"}`;
    },
    async exchange() {
      return {
        subject: "fixture-owner",
        accessToken: "private-fixture-access-token",
        expiresAt: Date.now() + 3600000,
      };
    },
    async userInfo() {
      return liveClaims;
    },
  };
  const app = createPortal({
    origin: "https://rotund.test",
    issuerOrigin: "https://issuer.test",
    sessionSecret: "fixture-secret-long-enough-for-tests-only",
    organizationId: org,
    bindings: serviceBindings,
    identity,
    publicDir: new URL("../public/", import.meta.url).pathname,
  });
  return {
    app,
    setClaims(claims: Record<string, unknown>) {
      liveClaims = claims;
    },
  };
}
const cookie = (r: Response) =>
  r.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
const request = (url: string, cookieValue = "") =>
  new Request("https://rotund.test" + url, {
    headers: { Cookie: cookieValue },
  });
async function signIn(app: ReturnType<typeof createPortal>) {
  const initial = await app.fetch(request("/"));
  assert.equal(initial.status, 302);
  assert.equal(
    new URL(initial.headers.get("Location")!).searchParams.get("prompt"),
    "none",
  );
  const state = new URL(initial.headers.get("Location")!).searchParams.get(
    "state",
  );
  const callback = await app.fetch(
    request(`/auth/callback?code=fixture-code&state=${state}`, cookie(initial)),
  );
  assert.equal(callback.status, 302);
  assert.notEqual(
    cookie(callback),
    cookie(initial),
    "authentication rotates session ID",
  );
  return cookie(callback);
}

test("silent SSO checks once, login_required becomes a usable anonymous page with no service disclosure", async () => {
  const { app } = fixture();
  const first = await app.fetch(request("/"));
  const state = new URL(first.headers.get("Location")!).searchParams.get(
    "state",
  );
  const cb = await app.fetch(
    request(
      `/auth/callback?error=login_required&state=${state}`,
      cookie(first),
    ),
  );
  const page = await app.fetch(request("/", cookie(cb)));
  const html = await page.text();
  assert.equal(page.status, 200);
  assert.match(html, /Sign in/);
  assert.match(html, /rotund\.png/);
  assert.doesNotMatch(
    html,
    /jellyfin\.rotund\.org|sonarr\.rotund\.org|gurgur\.rotund\.org/,
  );
  assert.match(
    html,
    /<style[^>]*data-rmx-style/,
    "native Remix styles render on the server",
  );
  const policy = page.headers.get("Content-Security-Policy")!;
  const nonce = policy.match(/style-src [^;]*'nonce-([^']+)'/)?.[1];
  assert.ok(nonce);
  assert.ok(html.includes(`nonce="${nonce}"`));
  assert.doesNotMatch(policy, /unsafe-inline/);
  assert.doesNotMatch(
    html,
    /rel="stylesheet"|style\.css/,
    "ordinary static styling has no external stylesheet",
  );
});

test("an explicit sign-in does not replace a pending silent callback", async () => {
  const { app } = fixture();
  const silent = await app.fetch(request("/"));
  const silentState = new URL(silent.headers.get("Location")!).searchParams.get(
    "state",
  )!;
  const page = await app.fetch(request("/?signed_out=1", cookie(silent)));
  const csrf = /name="csrf" value="([^"]+)"/.exec(await page.text())?.[1];
  assert.ok(csrf);
  const interactive = await app.fetch(
    new Request("https://rotund.test/auth/login", {
      method: "POST",
      headers: {
        Origin: "https://rotund.test",
        Cookie: cookie(page) || cookie(silent),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ csrf }),
    }),
  );
  assert.equal(interactive.status, 302);
  const interactiveState = new URL(
    interactive.headers.get("Location")!,
  ).searchParams.get("state")!;
  assert.notEqual(interactiveState, silentState);
  const currentCookie = cookie(interactive);
  assert.equal(
    (
      await app.fetch(
        request("/auth/callback?code=ignored&state=wrong", currentCookie),
      )
    ).status,
    400,
  );
  const silentResult = await app.fetch(
    request(
      `/auth/callback?error=login_required&state=${silentState}`,
      currentCookie,
    ),
  );
  assert.equal(silentResult.status, 302);
  const interactiveResult = await app.fetch(
    request(
      `/auth/callback?code=fixture-code&state=${interactiveState}`,
      cookie(silentResult),
    ),
  );
  assert.equal(interactiveResult.status, 302);
  const signedIn = await app.fetch(request("/", cookie(interactiveResult)));
  assert.match(await signedIn.text(), /sonarr\.rotund\.org/);
});

test("live entitlements are refreshed; removed role and changed subject never retain privileged links", async () => {
  const f = fixture();
  const signed = await signIn(f.app);
  const page = await f.app.fetch(request("/", signed));
  const html = await page.text();
  assert.match(html, /sonarr\.rotund\.org/);
  assert.doesNotMatch(html, /private-fixture-access-token/);
  assert.doesNotMatch(
    html,
    /gurgur|A place for your things|Your services|The things you can get into|Still rotund|A few more doors|Television, tracked|<header|<footer/,
  );
  assert.equal(
    page.headers.get("Referrer-Policy"),
    "same-origin",
    "same-origin browser form POSTs must retain Origin for strict CSRF checks",
  );
  assert.equal(page.headers.get("Cache-Control"), "private, no-store");
  assert.match(
    page.headers.get("Content-Security-Policy")!,
    /frame-ancestors 'none'/,
  );
  assert.match(
    page.headers.get("Content-Security-Policy")!,
    /form-action 'self' https:\/\/issuer\.test;/,
    "the native form redirect can reach only the configured issuer",
  );
  assert.match(page.headers.get("Vary")!, /Cookie/);
  f.setClaims({ sub: "fixture-owner" });
  assert.doesNotMatch(
    await (await f.app.fetch(request("/", signed))).text(),
    /sonarr\.rotund\.org/,
  );
  f.setClaims({
    sub: "different-fixture-subject",
    ...roles("fixture-admin", "admin"),
  });
  const mismatch = await f.app.fetch(request("/", signed));
  assert.doesNotMatch(await mismatch.text(), /sonarr\.rotund\.org/);
});

test("invalid/replayed callback, forged identity headers and cross-origin mutations fail closed", async () => {
  const { app } = fixture();
  const first = await app.fetch(request("/"));
  const c = cookie(first);
  assert.equal(
    (await app.fetch(request("/auth/callback?code=x&state=wrong", c))).status,
    400,
  );
  const forged = await app.fetch(
    new Request("https://rotund.test/?signed_out=1", {
      headers: {
        "X-Auth-Request-User": "fixture-owner",
        "X-Auth-Request-Groups": "admin",
        Cookie: "__Host-rotund=forged",
      },
    }),
  );
  assert.doesNotMatch(await forged.text(), /sonarr\.rotund\.org/);
  const csrf = await app.fetch(
    new Request("https://rotund.test/auth/logout", {
      method: "POST",
      headers: { Origin: "https://evil.test", Cookie: c },
      body: "csrf=anything",
    }),
  );
  assert.equal(csrf.status, 403);
  assert.equal((await app.fetch(request("/auth/logout"))).status, 405);
});
