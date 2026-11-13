import { createCookie } from "remix/cookie";
import { createRouter, type RouterContext } from "remix/router";
import { render } from "remix/middleware/render";
import { csp } from "remix/middleware/csp";
import { session } from "remix/middleware/session";
import { staticFiles } from "remix/middleware/static";
import type { SessionStorage } from "remix/session";
import type { Identity } from "./identity.js";
import type { Binding } from "./services.js";
import { createHomeController } from "./actions/controller.js";
import { createAuthController } from "./actions/auth/controller.js";
import { boundedSessions } from "./sessions.js";
import { routes } from "./routes.js";

export type PortalConfig = {
  origin: string;
  issuerOrigin: string;
  sessionSecret: string;
  organizationId: string;
  bindings: Binding[];
  identity: Identity;
  publicDir: string;
  storage?: SessionStorage;
};
function configuredRouter(config: PortalConfig) {
  if (config.sessionSecret.length < 32)
    throw new Error("A strong session secret is required");
  const cookie = createCookie("__Host-rotund", {
    secrets: [config.sessionSecret],
    secure: true,
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 3600,
  });
  return createRouter({
    middleware: [
      staticFiles(config.publicDir),
      session(cookie, config.storage ?? boundedSessions()),
      csp({
        policy: ({ nonce }) => ({
          defaultSrc: ["'none'"],
          scriptSrc: ["'none'"],
          imgSrc: ["'self'"],
          styleSrc: ["'self'", `'nonce-${nonce}'`],
          formAction: ["'self'", config.issuerOrigin],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
        }),
      }),
      render(),
    ],
  });
}
type AppContext = RouterContext<ReturnType<typeof configuredRouter>>;
declare module "remix" {
  interface RouterTypes {
    context: AppContext;
  }
}
export function createPortal(config: PortalConfig) {
  const issuerOrigin = new URL(config.issuerOrigin);
  if (
    issuerOrigin.protocol !== "https:" ||
    issuerOrigin.origin !== config.issuerOrigin
  )
    throw new Error("A canonical HTTPS issuer origin is required");
  const router = configuredRouter(config);
  router.map(routes, createHomeController(config));
  router.map(routes.auth, createAuthController(config));
  return {
    async fetch(request: Request) {
      const response = await router.fetch(request);
      response.headers.set("Cache-Control", "private, no-store");
      response.headers.set("Vary", "Cookie");
      response.headers.set("Referrer-Policy", "same-origin");
      response.headers.set("X-Content-Type-Options", "nosniff");
      return response;
    },
  };
}
