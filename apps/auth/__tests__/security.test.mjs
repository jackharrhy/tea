import test from "node:test";
import assert from "node:assert/strict";
import {
  localReturnTo,
  validPost,
  escapeHtml,
  randomToken,
  contentSecurityPolicy,
} from "../src/security.mjs";

test("return targets cannot escape the auth origin", () => {
  for (const value of [
    "https://evil.test",
    "//evil.test",
    "/\\evil.test",
    "/\r\nLocation:x",
    "/\t/evil.test",
    null,
  ])
    assert.equal(localReturnTo(value), "/");
  assert.equal(
    localReturnTo("/device?user_code=BCDF-GHJK"),
    "/device?user_code=BCDF-GHJK",
  );
});
test("forms require both a matching origin and a session-bound CSRF token", () => {
  const token = randomToken(),
    origin = "https://auth.jackharrhy.dev";
  assert.ok(validPost(origin, origin, token, token));
  assert.equal(validPost("https://evil.test", origin, token, token), false);
  assert.equal(validPost(origin, origin, randomToken(), token), false);
  assert.equal(validPost(undefined, origin, token, token), false);
  assert.equal(validPost(origin, origin, null, token), false);
});
test("identity-provider text cannot become active HTML", () => {
  assert.equal(
    escapeHtml('<img src=x onerror="alert(1)">'),
    "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
  );
});

test("form redirects allow only the current callback origin, without copying callback data into CSP", () => {
  assert.match(contentSecurityPolicy(), /form-action 'self';/);
  assert.match(
    contentSecurityPolicy(
      "https://consumer.example/callback?code=secret&state=private",
    ),
    /form-action 'self' https:\/\/consumer.example;/,
  );
  assert.ok(
    !contentSecurityPolicy(
      "https://consumer.example/callback?code=secret",
    ).includes("secret"),
  );
  for (const target of [
    "javascript:alert(1)",
    "data:text/html,x",
    "https://user:password@example.com/",
    "https://*.example.com/",
    "https://example.com;img-src/",
    "https://example'com/",
  ])
    assert.throws(() => contentSecurityPolicy(target));
});

test("support form redirects allow only configured consumer and issuer origins", () => {
  const policy = contentSecurityPolicy([
    "https://artbin.example/auth/support/callback",
    "https://issuer.example",
  ]);
  assert(
    policy.includes(
      "form-action 'self' https://artbin.example https://issuer.example;",
    ),
  );
  assert.throws(() =>
    contentSecurityPolicy(["https://safe.example", "javascript:alert(1)"]),
  );
});
test("only the login appearance explicitly allows first-party modules, with no inline/eval allowance", () => {
  assert(!contentSecurityPolicy().includes("script-src"));
  const policy = contentSecurityPolicy(undefined, { scripts: true });
  assert(policy.includes("script-src 'self'"));
  assert(!policy.includes("unsafe-inline"));
  assert(!policy.includes("unsafe-eval"));
});
