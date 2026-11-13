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

export function htmlCsp(formOrigins: string[] = []) {
  return csp({
    policy({ nonce }) {
      return {
        defaultSrc: ["'none'"],
        scriptSrc: [
          "'self'",
          `'nonce-${nonce}'`,
          "https://www.googletagmanager.com",
        ],
        styleSrc: ["'self'", `'nonce-${nonce}'`],
        styleSrcAttr: ["'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:", "https:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: [
          "'self'",
          "https://www.google-analytics.com",
          "https://*.google-analytics.com",
        ],
        frameSrc: [
          "'self'",
          "about:",
          "https://www.youtube.com",
          "https://www.youtube-nocookie.com",
          "https://player.vimeo.com",
        ],
        formAction: ["'self'", ...formOrigins],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
      };
    },
  });
}
