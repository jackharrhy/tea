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

export function initHostedAccess() {
  const root = document.querySelector<HTMLDetailsElement>(
    "#hosted-project-access",
  )!;
  const status = document.querySelector<HTMLElement>("#hosted-access-status")!;
  const search = document.querySelector<HTMLInputElement>(
    "#hosted-access-search",
  )!;
  const list = document.querySelector<HTMLUListElement>("#hosted-access-list")!;
  let project: HostedProject | null = null;
  let users: readonly HostedProjectAccessUser[] = [];
  let generation = 0;

  function render() {
    const query = search.value.trim().toLowerCase();
    const matching = users.filter((user) =>
      `${user.displayName} ${user.username}`.toLowerCase().includes(query),
    );
    const visible = matching.slice(0, 100);
    const members = users.filter((user) => user.role !== null).length;
    status.textContent = `${members} members · showing ${visible.length} of ${matching.length} matching users`;
    list.replaceChildren();
    if (visible.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = users.length
        ? "No users match this search"
        : "People appear after they sign in to Maps";
      list.append(empty);
      return;
    }
    for (const user of visible) {
      const row = document.createElement("li");
      const person = document.createElement("span");
      person.textContent = `${user.displayName} · @${user.username}`;
      row.append(person);
      if (user.role === "owner") {
        const owner = document.createElement("strong");
        owner.textContent = "Owner";
        row.append(owner);
      } else {
        const role = document.createElement("select");
        role.setAttribute("aria-label", `Access role for ${user.displayName}`);
        role.add(new Option("Editor", "editor"));
        role.add(new Option("Viewer", "viewer"));
        role.value = user.role ?? "editor";
        const save = document.createElement("button");
        save.type = "button";
        save.textContent = user.role ? "Update" : "Add";
        save.addEventListener("click", () => {
          const target = project;
          if (!target) return;
          save.disabled = true;
          void setHostedAccessRole(target.id, user.id, role.value as AccessRole)
            .then(async () => {
              if (project?.id === target.id) await refresh(target, generation);
            })
            .catch((error: unknown) => {
              status.textContent =
                error instanceof Error ? error.message : String(error);
              save.disabled = false;
            });
        });
        row.append(role, save);
        if (user.role) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = "Remove";
          remove.setAttribute(
            "aria-label",
            `Remove access for ${user.displayName}`,
          );
          remove.addEventListener("click", () => {
            const target = project;
            if (!target) return;
            remove.disabled = true;
            void removeHostedAccess(target.id, user.id)
              .then(async () => {
                if (project?.id === target.id)
                  await refresh(target, generation);
              })
              .catch((error: unknown) => {
                status.textContent =
                  error instanceof Error ? error.message : String(error);
                remove.disabled = false;
              });
          });
          row.append(remove);
        }
      }
      list.append(row);
    }
  }

  async function refresh(target: HostedProject, version: number) {
    status.textContent = "Loading project access";
    const listed = await listHostedAccess(target.id);
    if (version !== generation || project?.id !== target.id) return;
    users = listed;
    render();
  }

  search.addEventListener("input", render);

  return {
    setProject(next: HostedProject | null) {
      ++generation;
      project = next?.role === "owner" ? next : null;
      root.hidden = !project;
      users = [];
      search.value = "";
      list.replaceChildren();
      status.textContent = "";
      if (project) {
        void refresh(project, generation).catch((error: unknown) => {
          if (project?.id === next?.id)
            status.textContent =
              error instanceof Error ? error.message : String(error);
        });
      }
    },
  };
}
