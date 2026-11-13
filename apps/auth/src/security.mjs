import { randomBytes, timingSafeEqual } from "node:crypto";

export const randomToken = () => randomBytes(32).toString("base64url");
export function equalToken(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function escapeHtml(value) {
  return String(value === undefined ? "" : value).replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}
export function localReturnTo(value) {
  if (typeof value !== "string" || !/^\/(?!\/)/.test(value)) return "/";
  for (const character of value)
    if (character === "\\" || character.charCodeAt(0) <= 32) return "/";
  return value;
}
export function validPost(origin, expectedOrigin, suppliedToken, sessionToken) {
  return origin === expectedOrigin && equalToken(suppliedToken, sessionToken);
}

export function contentSecurityPolicy(
  callback,
  { scripts = false, styleNonce } = {},
) {
  const origins = new Set();
  for (const value of Array.isArray(callback)
    ? callback
    : callback
      ? [callback]
      : []) {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      /[\s;'"\\*]/.test(url.origin)
    )
      throw new Error("Invalid authorization callback");
    origins.add(url.origin);
  }
  const destination = [...origins].map((origin) => ` ${origin}`).join("");
  // Browsers apply form-action to the entire redirect chain after a form POST.
  if (styleNonce && !/^[A-Za-z0-9_-]{16,}$/.test(styleNonce))
    throw new Error("Invalid style nonce");
  return `default-src 'none'; ${scripts ? "script-src 'self'; " : ""}style-src 'self'${styleNonce ? ` 'nonce-${styleNonce}'` : ""}; font-src 'self'; form-action 'self'${destination}; base-uri 'none'; frame-ancestors 'none'`;
}
