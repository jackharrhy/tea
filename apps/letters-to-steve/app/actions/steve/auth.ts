import { timingSafeEqual } from "node:crypto";

export type SteveAccess = "authorized" | "unauthorized" | "unconfigured";

export function getSteveAccess(request: Request): SteveAccess {
  let expectedPassword = process.env.STEVE_ADMIN_PASSWORD;
  if (!expectedPassword) return "unconfigured";

  let authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Basic ")) return "unauthorized";

  let decoded: string;
  try {
    decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  } catch {
    return "unauthorized";
  }

  let separator = decoded.indexOf(":");
  if (separator < 0) return "unauthorized";

  let username = decoded.slice(0, separator);
  let password = decoded.slice(separator + 1);

  return username === "steve" && secureEqual(password, expectedPassword)
    ? "authorized"
    : "unauthorized";
}

export function challengeSteve(): Response {
  return new Response("Steve only.", {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
      "WWW-Authenticate": 'Basic realm="Letters to Steve", charset="UTF-8"',
    },
  });
}

function secureEqual(actual: string, expected: string): boolean {
  let actualBytes = Buffer.from(actual);
  let expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}
