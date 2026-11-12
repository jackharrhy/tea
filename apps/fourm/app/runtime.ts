import type { Community, Member } from "./data/community.ts";
import { CommunityError } from "./data/community.ts";
import type { CommunityCell } from "./data/community-cell.ts";

export interface Bindings {
  ASSETS: Fetcher;
  COMMUNITIES: DurableObjectNamespace<CommunityCell>;
  MEDIA: R2Bucket;
  AUTH_ISSUER: string;
  REVIEW_SOURCE_FINGERPRINT?: string;
  AUTH_CLIENT_ID: string;
  AUTH_PROJECT_ID: string;
  AUTH_ORGANIZATION_ID: string;
  AUTH_PUBLIC_ORIGIN: string;
  AUTH_CLI_CLIENT_ID?: string;
  AUTH_INTROSPECTION_CLIENT_ID?: string;
  AUTH_INTROSPECTION_SECRET?: string;
  AUTH_ENROLLMENT_KEY?: string;
}
export function runtime(env: Bindings) {
  const cell = env.COMMUNITIES.get(
    env.COMMUNITIES.idFromName("fourm-community-v1"),
  );
  return {
    async cleanupOrphanFiles(actorId: number | null) {
      const result = await cell.cleanupOrphanFiles(actorId);
      if (!result.ok) throw new CommunityError(result.status, result.error);
      return result.count;
    },
    async cleanupMissingMediaRecords(actorId: number | null) {
      const result = await cell.cleanupMissingMediaRecords(actorId);
      if (!result.ok) throw new CommunityError(result.status, result.error);
      return result.count;
    },
    async deleteAccount(actorId: number | null, userId: number, mode: string) {
      const result = await cell.deleteAccount(actorId, userId, mode);
      if (!result.ok) throw new CommunityError(result.status, result.error);
      return result.count;
    },
    async removeMedia(actorId: number, mediaId: number) {
      const result = await cell.removeMedia(actorId, mediaId);
      if (!result.ok) throw new CommunityError(result.status, result.error);
    },
    async renameMedia(actorId: number, mediaId: number, filename: string) {
      const result = await cell.renameMedia(actorId, mediaId, filename);
      if (!result.ok) throw new CommunityError(result.status, result.error);
    },
    async adminRenameUsername(
      actorId: number,
      userId: number,
      username: string,
      displayName: string,
    ) {
      const result = await cell.adminRenameUsername(
        actorId,
        userId,
        username,
        displayName,
      );
      if (!result.ok) throw new CommunityError(result.status, result.error);
    },
    async renameUsername(actorId: number, username: string) {
      const result = await cell.renameUsername(actorId, username);
      if (!result.ok) throw new CommunityError(result.status, result.error);
    },
    async call<K extends keyof Community>(
      method: K,
      ...args: Parameters<Community[K]>
    ): Promise<Awaited<ReturnType<Community[K]>>> {
      const result = await cell.call(method, args);
      if (!result.ok)
        throw new CommunityError(
          result.status,
          result.error,
          result.retryAfter,
        );
      return result.value as Awaited<ReturnType<Community[K]>>;
    },
  };
}
export type Runtime = ReturnType<typeof runtime>;
export interface Viewer {
  member: Member | null;
  sessionHash: string | null;
}
export async function hash(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export function token() {
  return (
    crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "")
  );
}
export function readCookie(request: Request, name: string) {
  return (
    request.headers
      .get("Cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? null
  );
}
export function cookie(
  env: Bindings,
  name: string,
  value: string,
  maxAge: number,
) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${env.AUTH_PUBLIC_ORIGIN.startsWith("https:") ? "; Secure" : ""}`;
}
