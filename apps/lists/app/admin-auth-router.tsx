import { eq } from "drizzle-orm";
import { css, type Handle } from "remix/component";
import { render } from "remix/middleware/render";
import { createRouter } from "remix/router";

import { createSession, destroySession } from "../src/auth.ts";
import type { Config } from "../src/config.ts";
import { schema, type Db } from "../src/db/index.ts";
import type { AppContext } from "./router.tsx";

const page = css({
  margin: 0,
  minHeight: "100dvh",
  display: "grid",
  placeItems: "center",
  backgroundColor: "#f9fafb",
  color: "#111827",
  fontFamily: "system-ui, sans-serif",
});
const panel = css({
  boxSizing: "border-box",
  width: "min(100% - 32px, 400px)",
  padding: "32px",
  border: "1px solid #e5e7eb",
  borderRadius: "8px",
  backgroundColor: "#fff",
});
const title = css({
  margin: "0 0 24px",
  fontSize: "22px",
  textAlign: "center",
});
const field = css({
  display: "grid",
  gap: "6px",
  marginBottom: "16px",
  fontSize: "14px",
});
const input = css({
  minHeight: "40px",
  boxSizing: "border-box",
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #d1d5db",
  borderRadius: "6px",
  font: "inherit",
});
const button = css({
  minHeight: "40px",
  width: "100%",
  border: 0,
  borderRadius: "6px",
  backgroundColor: "#1f2937",
  color: "#fff",
  font: "inherit",
  cursor: "pointer",
});
const errorStyle = css({
  padding: "10px",
  backgroundColor: "#fef2f2",
  color: "#991b1b",
  fontSize: "14px",
});

function LoginPage(handle: Handle<{ error?: string; returnTo: string }>) {
  return () => (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Login | Lists admin</title>
      </head>
      <body mix={page}>
        <main mix={panel}>
          <h1 mix={title}>Lists admin</h1>
          {handle.props.error ? (
            <p mix={errorStyle} role="alert">
              {handle.props.error}
            </p>
          ) : null}
          <form method="post" action="/admin/login">
            <input
              type="hidden"
              name="returnTo"
              value={handle.props.returnTo}
            />
            <label mix={field}>
              Email
              <input
                mix={input}
                type="email"
                name="email"
                autoComplete="email"
                required
              />
            </label>
            <label mix={field}>
              Password
              <input
                mix={input}
                type="password"
                name="password"
                autoComplete="current-password"
                required
              />
            </label>
            <button mix={button} type="submit">
              Log in
            </button>
          </form>
        </main>
      </body>
    </html>
  );
}

function safeReturnTo(value: string | null) {
  return value &&
    /^\/admin(?:\/|$)/.test(value) &&
    !value.includes("\\") &&
    !value.startsWith("//")
    ? value
    : "/admin/";
}

function sessionCookie(request: Request) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("session="))
    ?.slice(8);
}

export function createAdminAuthRouter(db: Db, config: Config) {
  const router = createRouter<AppContext>({ middleware: [render()] });
  router.get("/admin/login", (context) => {
    const returnTo = safeReturnTo(context.url.searchParams.get("returnTo"));
    if (config.identity)
      return new Response(null, {
        status: 302,
        headers: {
          Location:
            returnTo === "/admin/"
              ? "/auth/login"
              : `/auth/login?returnTo=${encodeURIComponent(returnTo)}`,
        },
      });
    return context.render(<LoginPage returnTo={returnTo} />);
  });
  router.post("/admin/login", async (context) => {
    if (config.identity)
      return new Response("Password sign-in is unavailable", { status: 404 });
    const form = await context.request.formData();
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const returnTo = safeReturnTo(String(form.get("returnTo") ?? ""));
    const user = db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .get();
    if (
      !user ||
      !password ||
      !(await Bun.password.verify(password, user.passwordHash))
    )
      return context.render(
        <LoginPage error="Invalid email or password." returnTo={returnTo} />,
        { status: 401 },
      );
    const token = createSession(db, user.id);
    return new Response(null, {
      status: 303,
      headers: {
        Location: returnTo,
        "Set-Cookie": `session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`,
      },
    });
  });
  router.post("/admin/logout", ({ request }) => {
    const token = sessionCookie(request);
    if (token) destroySession(db, token);
    return new Response(null, {
      status: 303,
      headers: {
        Location: "/admin/login",
        "Set-Cookie": "session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
      },
    });
  });
  return router;
}
