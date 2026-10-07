import {
  HostedErrorResponseSchema,
  HostedOkResponseSchema,
  HostedProjectMembersResponseSchema,
  SetProjectMemberRoleRequestSchema,
  type HostedProject,
  type HostedProjectAccessUser,
} from "@tea/maps-protocol";

type AccessRole = "editor" | "viewer";

async function decode<T>(
  response: Response,
  schema: {
    safeParse(value: unknown): { success: true; data: T } | { success: false };
  },
): Promise<T> {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = HostedErrorResponseSchema.safeParse(payload);
    throw new Error(
      error.success ? error.data.error : `Request failed (${response.status})`,
    );
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success)
    throw new Error("Maps service returned an invalid response");
  return parsed.data;
}

function memberPath(projectId: string, userId?: string): string {
  const base = `/api/projects/${encodeURIComponent(projectId)}/members`;
  return userId ? `${base}/${encodeURIComponent(userId)}` : base;
}

export async function listHostedAccess(
  projectId: string,
  fetcher: typeof fetch = fetch,
): Promise<readonly HostedProjectAccessUser[]> {
  const response = await fetcher(memberPath(projectId), {
    credentials: "same-origin",
  });
  return (await decode(response, HostedProjectMembersResponseSchema)).users;
}

export async function setHostedAccessRole(
  projectId: string,
  userId: string,
  role: AccessRole,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const request = SetProjectMemberRoleRequestSchema.parse({ role });
  const response = await fetcher(memberPath(projectId, userId), {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  await decode(response, HostedOkResponseSchema);
}

export async function removeHostedAccess(
  projectId: string,
  userId: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const response = await fetcher(memberPath(projectId, userId), {
    method: "DELETE",
    credentials: "same-origin",
  });
  await decode(response, HostedOkResponseSchema);
}

const projectChangeEvent = "tea-maps-hosted-access-project-change";
type AccessWindow = Window & { teaMapsHostedAccessProject?: string | null };

export function currentHostedAccessProject(): string | null {
  return (window as AccessWindow).teaMapsHostedAccessProject ?? null;
}

export function onHostedAccessProjectChange(
  listener: () => void,
  signal: AbortSignal,
): void {
  window.addEventListener(projectChangeEvent, listener, { signal });
}

export function initHostedAccess() {
  return {
    setProject(next: HostedProject | null) {
      (window as AccessWindow).teaMapsHostedAccessProject =
        next?.role === "owner" ? next.id : null;
      window.dispatchEvent(new Event(projectChangeEvent));
    },
  };
}
