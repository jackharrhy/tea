import { createController, createRouter } from "remix/router";
import { del, get, post, put, route as defineRoutes } from "remix/routes";
import { ServiceHttpError } from "./service-http.js";
import { webErrorFromUnknown } from "./service-web-http.js";

export type ServiceMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface ServiceRouteMatch {
  readonly captures: readonly string[];
}

export interface WebServiceRequestContext {
  readonly request: Request;
  readonly url: URL;
  readonly publicOrigin: string;
  readonly secureCookies: boolean;
}

export interface ServiceRoute {
  readonly id: string;
  readonly method: ServiceMethod;
  readonly pattern: string | RegExp;
  readonly handle: (
    context: WebServiceRequestContext,
    match: ServiceRouteMatch,
  ) => Response | Promise<Response>;
}

export function defineWebRoute(
  id: string,
  method: ServiceMethod,
  pattern: string | RegExp,
  handle: ServiceRoute["handle"],
): ServiceRoute {
  if (pattern instanceof RegExp && (pattern.global || pattern.sticky)) {
    throw new Error(`Route ${id} cannot use a stateful regular expression`);
  }
  if (
    pattern instanceof RegExp &&
    (!pattern.source.startsWith("^") || !pattern.source.endsWith("$"))
  ) {
    throw new Error(`Route ${id} regular expression must match the whole path`);
  }
  return {
    id,
    method,
    pattern,
    async handle(context, match) {
      try {
        return await handle(context, match);
      } catch (error) {
        return webErrorFromUnknown(error);
      }
    },
  };
}

export function matchRoute(
  route: ServiceRoute,
  method: string | undefined,
  pathname: string,
): ServiceRouteMatch | null {
  if (method !== route.method) return null;
  if (typeof route.pattern === "string") {
    return pathname === route.pattern ? { captures: [] } : null;
  }
  const matched = route.pattern.exec(pathname);
  return matched ? { captures: matched.slice(1) } : null;
}

export function createServiceDispatcher(routes: readonly ServiceRoute[]) {
  const router = createRouter();
  for (const serviceRoute of routes) {
    const pattern = remixPattern(serviceRoute.pattern);
    const method = { GET: get, POST: post, PUT: put, DELETE: del }[
      serviceRoute.method
    ];
    const mapped = defineRoutes({ action: method(pattern) });
    router.map(
      mapped,
      createController(mapped, {
        actions: {
          action(context) {
            const url = new URL(context.request.url);
            const match = matchRoute(
              serviceRoute,
              context.request.method,
              url.pathname,
            );
            if (!match) return new Response(null, { status: 404 });
            return serviceRoute.handle(
              {
                request: context.request,
                url,
                publicOrigin: url.origin,
                secureCookies: url.protocol === "https:",
              },
              match,
            );
          },
        },
      }),
    );
  }
  return (request: Request): Promise<Response | null> => {
    const pathname = new URL(request.url).pathname;
    if (
      !routes.some((candidate) =>
        matchRoute(candidate, request.method, pathname),
      )
    ) {
      return Promise.resolve(null);
    }
    return router.fetch(request);
  };
}

function remixPattern(pattern: ServiceRoute["pattern"]): string {
  if (typeof pattern === "string") return pattern;
  const path = pattern.source
    .slice(1, -1)
    .replaceAll("\\/", "/")
    .replaceAll("([^/]+)", ":part")
    .replaceAll("([a-f0-9]{64})", ":digest");
  if (path.includes("(") || path.includes("\\")) {
    throw new Error(`Cannot map route pattern ${pattern} to Remix`);
  }
  return path;
}

export function pathParameter(match: ServiceRouteMatch, index: number): string {
  const encoded = match.captures[index];
  if (encoded === undefined)
    throw new Error(`Route capture ${index} is missing`);
  try {
    return decodeURIComponent(encoded);
  } catch {
    throw new ServiceHttpError(400, "Request path contains invalid encoding");
  }
}
