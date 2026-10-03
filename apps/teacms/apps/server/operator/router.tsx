import { fileURLToPath } from "node:url";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createController, createRouter } from "remix/router";
import { render } from "remix/middleware/render";
import { staticFiles } from "remix/middleware/static";
import { cop } from "remix/middleware/cop";
import { cookieValue, sessionCookie } from "@teacms/core/data/auth.ts";
import type { SiteRuntime } from "@teacms/core/site.ts";
import type { TeaDatabase } from "@teacms/core/data/database.ts";
import { assets } from "@teacms/core/assets.ts";
import { operatorRoutes } from "./routes.ts";
import { Dashboard, Login, type Summary } from "./ui.tsx";
import { Design } from "./design.tsx";
import type { OperatorStore } from "./store.ts";

const cookieName = "tea-operator-session";
const csrfCookieName = "tea-operator-csrf";
function csrfToken(request: Request) {
  const existing = cookieValue(request, csrfCookieName);
  return /^[a-f0-9]{64}$/.test(existing)
    ? existing
    : randomBytes(32).toString("hex");
}
function validCsrf(request: Request, value: FormDataEntryValue | null) {
  const existing = cookieValue(request, csrfCookieName);
  return (
    typeof value === "string" &&
    /^[a-f0-9]{64}$/.test(existing) &&
    /^[a-f0-9]{64}$/.test(value) &&
    timingSafeEqual(Buffer.from(existing), Buffer.from(value))
  );
}
type SiteRow = { site: SiteRuntime; database: TeaDatabase };
function summarize({ site, database }: SiteRow): Summary {
  const sqlite = database.sqlite;
  try {
    const row = sqlite
      .prepare(
        "SELECT site_name,description,analytics_enabled FROM site_preferences",
      )
      .get();
    sqlite.prepare("SELECT 1").get();
    return {
      id: site.id,
      name: String(row?.site_name || site.name),
      origin: site.origin,
      description: String(row?.description || ""),
      preview: site.preview,
      healthy: true,
      pages: Number(sqlite.prepare("SELECT count(*) AS n FROM pages").get()?.n),
      drafts: Number(
        sqlite.prepare("SELECT count(*) AS n FROM page_drafts").get()?.n,
      ),
      media: Number(sqlite.prepare("SELECT count(*) AS n FROM media").get()?.n),
      analytics: !!row?.analytics_enabled,
    };
  } catch {
    return {
      id: site.id,
      name: site.name,
      origin: site.origin,
      description: "",
      preview: site.preview,
      healthy: false,
      pages: 0,
      drafts: 0,
      media: 0,
      analytics: false,
    };
  }
}

export function createOperatorRouter(
  store: OperatorStore,
  origin: string,
  sites: SiteRow[],
) {
  const byId = new Map(sites.map(({ site }) => [site.id, site]));
  const router = createRouter({
    middleware: [
      staticFiles(fileURLToPath(new URL("./public", import.meta.url)), {
        index: false,
      }),
      staticFiles(
        fileURLToPath(
          new URL("../../../packages/teacms/public", import.meta.url),
        ),
        { index: false },
      ),
      cop({ trustedOrigins: [origin] }),
      async (context, next) => {
        if (!["GET", "HEAD"].includes(context.request.method)) {
          const sentOrigin = context.request.headers.get("origin");
          if (sentOrigin && sentOrigin !== "null" && sentOrigin !== origin)
            return new Response("Wrong origin", { status: 403 });
        }
        const response = await next();
        response?.headers.set("Cache-Control", "no-store");
        response?.headers.set("X-Robots-Tag", "noindex, nofollow");
        response?.headers.set("X-Content-Type-Options", "nosniff");
        response?.headers.set("Referrer-Policy", "no-referrer");
        return response;
      },
      render({ assets }),
    ],
  });
  router.map(
    operatorRoutes,
    createController(operatorRoutes, {
      actions: {
        index(context) {
          const user = store.auth.resolve(
            cookieValue(context.request, cookieName),
          );
          if (!user)
            return new Response(null, {
              status: 303,
              headers: { Location: "/login" },
            });
          const csrf = csrfToken(context.request);
          const response = context.render(
            <Dashboard
              email={user.email}
              sites={sites.map(summarize)}
              csrf={csrf}
            />,
          );
          response.headers.append(
            "Set-Cookie",
            sessionCookie(
              context.request,
              csrf,
              new Date(Date.now() + 12 * 60 * 60_000),
              origin,
              csrfCookieName,
            ),
          );
          return response;
        },
        login(context) {
          if (store.auth.resolve(cookieValue(context.request, cookieName)))
            return new Response(null, {
              status: 303,
              headers: { Location: "/" },
            });
          const csrf = csrfToken(context.request);
          const response = context.render(<Login csrf={csrf} />);
          response.headers.append(
            "Set-Cookie",
            sessionCookie(
              context.request,
              csrf,
              new Date(Date.now() + 12 * 60 * 60_000),
              origin,
              csrfCookieName,
            ),
          );
          return response;
        },
        design(context) {
          return context.render(<Design />);
        },
        async authenticate(context) {
          const data = await context.request.formData();
          if (!validCsrf(context.request, data.get("csrf")))
            return new Response("Invalid form token", { status: 403 });
          const email = data.get("email"),
            password = data.get("password");
          if (
            typeof email !== "string" ||
            typeof password !== "string" ||
            email.length > 320 ||
            password.length > 200
          )
            return new Response("Invalid input", { status: 400 });
          const user = await store.auth.verify(email, password);
          if (!user)
            return context.render(
              <Login
                csrf={csrfToken(context.request)}
                error="Email or password is incorrect."
              />,
              { status: 401 },
            );
          store.auth.revoke(cookieValue(context.request, cookieName));
          const session = store.auth.createSession(user.id, 12 * 60 * 60_000);
          return new Response(null, {
            status: 303,
            headers: {
              Location: "/",
              "Set-Cookie": sessionCookie(
                context.request,
                session.id,
                session.expiresAt,
                origin,
                cookieName,
                "Lax",
              ),
            },
          });
        },
        async logout(context) {
          const data = await context.request.formData();
          if (!validCsrf(context.request, data.get("csrf")))
            return new Response("Invalid form token", { status: 403 });
          store.auth.revoke(cookieValue(context.request, cookieName));
          return new Response(null, {
            status: 303,
            headers: {
              Location: "/login",
              "Set-Cookie": sessionCookie(
                context.request,
                "",
                new Date(0),
                origin,
                cookieName,
              ),
            },
          });
        },
        async enter(context) {
          const data = await context.request.formData();
          if (!validCsrf(context.request, data.get("csrf")))
            return new Response("Invalid form token", { status: 403 });
          const operatorSessionId = cookieValue(context.request, cookieName);
          if (!store.auth.resolve(operatorSessionId))
            return new Response(null, {
              status: 303,
              headers: { Location: "/login" },
            });
          const site = byId.get(context.params.siteId);
          if (!site) return new Response("Unknown site", { status: 404 });
          const ticket = store.issueTicket(operatorSessionId, site.id);
          if (!ticket) return new Response("Session expired", { status: 401 });
          return new Response(null, {
            status: 303,
            headers: {
              Location: `${site.origin}/tea/operator-enter?ticket=${ticket}`,
              "Cache-Control": "no-store",
              "Referrer-Policy": "no-referrer",
            },
          });
        },
      },
    }),
  );
  return router;
}
