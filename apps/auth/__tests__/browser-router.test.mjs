import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserRouter } from "../src/browser-router.mjs";

test("account writes reach their route actions, while unrelated pages use the browser fallback", async () => {
  const accountRoutes = Object.fromEntries(
    ["account", "email", "password", "resendEmail"].map((name) => [
      name,
      () => name,
    ]),
  );
  const router = createBrowserRouter(
    (_request, action) => new Response(action?.() ?? "fallback"),
    {
      accountRoutes,
      oauthRoutes: { authorize: () => "authorize", device: () => "device" },
      emailRoutes: {
        verifyEmail: () => "verifyEmail",
        forgotPassword: () => "forgotPassword",
        resetPassword: () => "resetPassword",
      },
    },
  );
  for (const [path, expected] of [
    ["/account", "account"],
    ["/account/email", "email"],
    ["/account/password", "password"],
    ["/account/email/resend", "resendEmail"],
    ["/authorize", "authorize"],
    ["/device", "device"],
    ["/verify-email", "verifyEmail"],
    ["/forgot-password", "forgotPassword"],
    ["/reset-password", "resetPassword"],
    ["/unknown", "fallback"],
  ]) {
    const response = await router.fetch(
      new Request(`https://auth.test${path}`),
    );
    assert.equal(await response.text(), expected, path);
  }
});
