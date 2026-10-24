const COOKIE_NAME = "ref_session";

export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get("Cookie") ?? "";
  const match = new RegExp(
    `(?:^|;\\s*)${COOKIE_NAME}=([0-9a-f]{64})(?:;|$)`,
  ).exec(header);
  return match?.[1] ?? null;
}

export function sessionCookie(token: string, request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`;
}

export function clearSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}
