import type { Middleware } from "remix/router";

export const headRequests: Middleware = async (context, next) => {
  if (context.method !== "HEAD") return next();

  // Match GET routes, but keep the original HEAD request for file responses.
  context.method = "GET";
  const response = await next();
  await response.body?.cancel();
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};
