import { csp } from "remix/middleware/csp";

export async function htmlNoStore(
  _context: unknown,
  next: () => Promise<Response>,
) {
  const response = await next();
  if (response.headers.get("Content-Type")?.startsWith("text/html"))
    response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const htmlCsp = csp({
  filter(response) {
    return (
      response.headers.get("Content-Type")?.startsWith("text/html") === true &&
      !response.headers.has("Content-Security-Policy")
    );
  },
  policy({ nonce, context }) {
    const path = new URL(context.request.url).pathname;
    const inboundPreview = path.startsWith("/admin/inbound");
    return {
      defaultSrc: ["'none'"],
      scriptSrc: ["'self'", `'nonce-${nonce}'`],
      styleSrc: ["'self'", `'nonce-${nonce}'`],
      ...(inboundPreview
        ? { styleSrcElem: ["'self'", "'unsafe-inline'"] }
        : {}),
      styleSrcAttr: ["'unsafe-inline'"],
      imgSrc: inboundPreview
        ? ["'self'", "data:", "cid:", "https:"]
        : ["'self'", "data:", "blob:"],
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameSrc: ["'self'", "about:"],
      formAction: ["'self'"],
      baseUri: ["'none'"],
      objectSrc: ["'none'"],
    };
  },
});
