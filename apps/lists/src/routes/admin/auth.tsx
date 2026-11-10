/** @jsxRuntime classic */
/** @jsx Html.createElement */
/** @jsxFrag Html.Fragment */
// oxlint-disable-next-line no-unused-vars -- Html is the classic JSX factory.
import { Html } from "@elysia/html";
import type { App } from "../../http";
import { eq } from "drizzle-orm";
import type { Db } from "../../db";
import { schema } from "../../db";
import type { Config } from "../../config";
import { createSession, destroySession } from "../../auth";
import { setFlash, getFlash } from "./layout";
import { assetUrl } from "../../assets";
import { Button, Input, Label } from "./ui";

function LoginPage({
  flash,
  error,
  returnTo,
}: {
  flash?: string;
  error?: string;
  returnTo?: string;
}) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Login - Lists Admin</title>
        <link rel="stylesheet" href={assetUrl("/static/styles.css")} />
        <script src={assetUrl("/static/app.js")} defer></script>
      </head>
      <body class="m-0 flex min-h-[100dvh] items-center justify-center bg-gray-50 px-4 font-sans text-gray-900">
        <main class="box-border w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 sm:p-8">
          <h1 class="m-0 mb-6 text-center text-xl font-bold">Lists admin</h1>
          {flash && (
            <p
              safe
              class="rounded-md border border-green-300 bg-green-100 px-3 py-2 text-center text-sm text-green-800"
            >
              {flash}
            </p>
          )}
          {error && (
            <p
              safe
              class="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-center text-sm text-red-700"
            >
              {error}
            </p>
          )}
          <form method="post" action="/admin/login">
            {returnTo && (
              <input type="hidden" name="returnTo" value={returnTo} />
            )}
            <Label for="email">Email</Label>
            <Input
              type="email"
              id="email"
              name="email"
              autocomplete="email"
              required
              autofocus
            />
            <Label for="password">Password</Label>
            <Input
              type="password"
              id="password"
              name="password"
              autocomplete="current-password"
              required
            />
            <Button type="submit" class="w-full">
              Log in
            </Button>
          </form>
        </main>
      </body>
    </html>
  );
}

export function mountAuthRoutes(app: App, db: Db, config: Config) {
  app.get("/login", (c) => {
    if (config.identity) {
      const returnTo = (c.query as Record<string, string | undefined>).returnTo;
      return c.redirect(
        returnTo
          ? `/auth/login?returnTo=${encodeURIComponent(returnTo)}`
          : "/auth/login",
        302,
      );
    }
    const flash = getFlash(c);
    return c.html(
      <LoginPage
        flash={flash}
        returnTo={(c.query as Record<string, string | undefined>).returnTo}
      />,
    );
  });

  app.post("/login", async (c) => {
    if (config.identity) return c.text("Password sign-in is unavailable", 404);
    const body = c.body as Record<string, any>;
    const email = body["email"] as string;
    const password = body["password"] as string;
    const requestedReturnTo = String(body["returnTo"] ?? "");
    const returnTo =
      requestedReturnTo.startsWith("/") && !requestedReturnTo.startsWith("//")
        ? requestedReturnTo
        : "/admin/";

    const renderError = (message: string) => {
      c.set.status = 401;
      return c.html(<LoginPage error={message} returnTo={returnTo} />);
    };

    if (!email || !password)
      return renderError("Email and password are required.");

    const user = db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .get();

    if (!user) return renderError("Invalid email or password.");

    const valid = await Bun.password.verify(password, user.passwordHash);
    if (!valid) return renderError("Invalid email or password.");

    const token = createSession(db, user.id);
    c.cookie.session!.set({
      value: token,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 86400,
    });
    return c.redirect(returnTo);
  });

  app.post("/logout", (c) => {
    const token = c.cookie.session!.value;
    if (typeof token === "string") {
      destroySession(db, token);
    }
    c.cookie.session!.remove();
    setFlash(c, "Signed out.");
    return c.redirect("/admin/login");
  });
}
