import { createController } from "remix/router";
import type { Handle } from "remix/component";
import { routes } from "../../routes.ts";
import {
  authContext,
  userContext,
  siteContext,
} from "../../middleware/context.ts";
import {
  cookieValue,
  operatorSiteCookieName,
  sessionCookie,
  sessionId,
  siteSessionCookieName,
} from "../../data/auth.ts";
import type { SiteRuntime } from "../../site.ts";
import type { OperatorAccess } from "../../operator-access.ts";
import { readInput, invalid } from "../input.ts";
import { Document } from "../../ui/document.tsx";
import { AdminBrand } from "../../ui/admin-brand.tsx";

function Login(handle: Handle<{ error?: string; siteName: string }>) {
  return () => (
    <Document title="Sign in · teacms" admin>
      <main className="login-layout">
        <section className="login-intro">
          <AdminBrand href="/" />
          <p>{handle.props.siteName}</p>
        </section>
        <section className="login-panel">
          <form
            method="post"
            action={routes.auth.authenticate.href()}
            data-rmx-document
          >
            <h1>Sign in</h1>
            {handle.props.error && (
              <p role="alert" className="notice error">
                {handle.props.error}
              </p>
            )}
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="username"
                required
                autoFocus
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <button className="button primary">Sign in</button>
            <a className="muted" href="/">
              Open website ↗
            </a>
          </form>
        </section>
      </main>
    </Document>
  );
}
export function createAuthController(
  site: SiteRuntime,
  operator?: OperatorAccess,
) {
  return createController(routes.auth, {
    actions: {
      login(context) {
        return context.get(userContext)
          ? new Response(null, {
              status: 303,
              headers: { Location: routes.admin.index.href() },
            })
          : context.render(<Login siteName={context.get(siteContext).name} />);
      },
      async authenticate(context) {
        const data = await readInput(context.request);
        if (
          !data ||
          typeof data.email !== "string" ||
          typeof data.password !== "string" ||
          data.email.length > 320 ||
          data.password.length > 200
        )
          return invalid();
        const auth = context.get(authContext);
        if (auth.throttled(data.email.trim().toLowerCase()))
          return context.render(
            <Login
              siteName={context.get(siteContext).name}
              error="Too many attempts. Try again in 15 minutes."
            />,
            { status: 429 },
          );
        const user = await auth.verify(data.email, data.password);
        if (!user)
          return context.render(
            <Login
              siteName={context.get(siteContext).name}
              error="Email or password is incorrect."
            />,
            { status: 401 },
          );
        auth.revoke(sessionId(context.request, site.id));
        const session = auth.createSession(user.id);
        return new Response(null, {
          status: 303,
          headers: {
            Location: routes.admin.index.href(),
            "Set-Cookie": sessionCookie(
              context.request,
              session.id,
              session.expiresAt,
              context.get(siteContext).origin,
              siteSessionCookieName(site.id),
            ),
          },
        });
      },
      logout(context) {
        context.get(authContext).revoke(sessionId(context.request, site.id));
        operator?.revokeSiteSession(
          site.id,
          cookieValue(context.request, operatorSiteCookieName(site.id)),
        );
        const response = new Response(null, {
          status: 303,
          headers: {
            Location: routes.auth.login.href(),
          },
        });
        for (const name of [
          siteSessionCookieName(site.id),
          operatorSiteCookieName(site.id),
        ])
          response.headers.append(
            "Set-Cookie",
            sessionCookie(context.request, "", new Date(0), site.origin, name),
          );
        return response;
      },
    },
  });
}
