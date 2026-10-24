import type { HostedSessionUser } from "@tea/maps-protocol";
import type { MapsDatabase, MapsUser } from "./database.js";

export const SESSION_COOKIE = "tea_maps_session";
export const AUTOMATION_COOKIE = "tea_maps_automation";
export const OAUTH_COOKIE = "tea_maps_oauth";
export const MAX_HOSTED_MAP_BYTES = 2 * 1024 * 1024;

export interface SessionRequestContext {
  readonly request: Request;
  readonly url: URL;
}

export class ServiceHttpError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function cookie(request: Request, name: string): string | undefined {
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const [key, ...rest] = part.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(rest.join("="));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function sessionUser(
  context: SessionRequestContext,
  database: MapsDatabase,
): MapsUser | null {
  const regular = database.sessionUser(cookie(context.request, SESSION_COOKIE));
  if (regular) return regular;
  const grant = database.automationSession(
    cookie(context.request, AUTOMATION_COOKIE),
  );
  if (!grant) return null;
  const { pathname } = context.url;
  const method = context.request.method;
  if (method === "GET" && pathname === "/api/session") return grant.user;
  const projectPath = /^\/api\/projects\/([^/]+)(?:\/(.*))?$/.exec(pathname);
  if (projectPath && projectPath[1] === grant.projectId) {
    const tail = projectPath[2] ?? "";
    if (
      method === "GET" &&
      (tail === "" ||
        tail === "resources" ||
        /^resources\/[^/]+\/content$/.test(tail))
    )
      return grant.user;
    if (method === "POST" && tail === "maps") return grant.user;
    const mapSourcePath = /^maps\/([^/]+)\/source$/.exec(tail);
    if (
      method === "PUT" &&
      mapSourcePath &&
      database.map(mapSourcePath[1]!, grant.user.id)?.projectId ===
        grant.projectId
    )
      return grant.user;
    if (method === "POST" && tail === "resources") return grant.user;
    if (method === "PUT" && tail === "resources/upload") return grant.user;
    if (method === "DELETE" && /^resources\/[^/]+$/.test(tail))
      return grant.user;
  }
  const mapPath = /^\/api\/maps\/([^/]+)(?:\/(.*))?$/.exec(pathname);
  if (
    mapPath &&
    database.map(mapPath[1]!, grant.user.id)?.projectId === grant.projectId
  ) {
    const tail = mapPath[2] ?? "";
    if (
      method === "GET" &&
      (tail === "" ||
        tail === "checkpoints" ||
        /^checkpoints\/[^/]+$/.test(tail) ||
        tail === "builds" ||
        /^builds\/[^/]+\/artifacts\/[a-f0-9]{64}$/.test(tail))
    )
      return grant.user;
    if (
      method === "POST" &&
      (tail === "checkpoints" ||
        tail === "realtime-ticket" ||
        tail === "builds")
    )
      return grant.user;
  }
  return null;
}

export function publicSessionUser(
  user: MapsUser | null,
): HostedSessionUser | null {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    isAdmin: user.isAdmin,
  };
}
