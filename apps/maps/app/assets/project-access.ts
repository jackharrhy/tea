import type {
  HostedProject,
  HostedProjectAccessUser,
} from "@tea/maps-protocol";
import {
  listHostedAccess,
  removeHostedAccess,
  setHostedAccessRole,
} from "./editor-hosted-access.ts";

export async function showProjectAccess(project: HostedProject) {
  const status = document.querySelector<HTMLElement>("#project-access-status")!;
  const search = document.querySelector<HTMLInputElement>(
    "#project-access-search",
  )!;
  const list = document.querySelector<HTMLElement>("#project-access-list")!;
  if (project.role !== "owner") {
    status.textContent = "Only the project owner can manage access";
    search.hidden = true;
    return;
  }

  let users: readonly HostedProjectAccessUser[] = [];
  function render() {
    const query = search.value.trim().toLowerCase();
    const matching = users.filter((user) =>
      `${user.displayName} ${user.username}`.toLowerCase().includes(query),
    );
    const visible = matching.slice(0, 100);
    const members = users.filter((user) => user.role !== null).length;
    status.textContent = `${members} members · showing ${visible.length} of ${matching.length} matching users`;
    list.replaceChildren();
    if (!visible.length)
      list.textContent = users.length
        ? "No users match this search"
        : "People appear after they sign in to Maps";
    for (const user of visible) {
      const row = document.createElement("div");
      row.className = "project-row";
      const person = document.createElement("strong");
      person.textContent = `${user.displayName} · @${user.username}`;
      row.append(person);
      if (user.role === "owner") {
        const owner = document.createElement("span");
        owner.textContent = "Owner";
        row.append(owner);
      } else {
        const actions = document.createElement("div");
        actions.className = "project-actions";
        const role = document.createElement("select");
        role.setAttribute("aria-label", `Access role for ${user.displayName}`);
        role.add(new Option("Editor", "editor"));
        role.add(new Option("Viewer", "viewer"));
        role.value = user.role ?? "editor";
        const save = document.createElement("button");
        save.type = "button";
        save.textContent = user.role ? "Update" : "Add";
        save.addEventListener("click", async () => {
          save.disabled = true;
          try {
            await setHostedAccessRole(
              project.id,
              user.id,
              role.value as "editor" | "viewer",
            );
            await refresh();
          } catch (error) {
            status.textContent =
              error instanceof Error ? error.message : String(error);
            save.disabled = false;
          }
        });
        actions.append(role, save);
        if (user.role) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.textContent = "Remove";
          remove.setAttribute(
            "aria-label",
            `Remove access for ${user.displayName}`,
          );
          remove.addEventListener("click", async () => {
            remove.disabled = true;
            try {
              await removeHostedAccess(project.id, user.id);
              await refresh();
            } catch (error) {
              status.textContent =
                error instanceof Error ? error.message : String(error);
              remove.disabled = false;
            }
          });
          actions.append(remove);
        }
        row.append(actions);
      }
      list.append(row);
    }
  }

  async function refresh() {
    status.textContent = "Loading project access";
    users = await listHostedAccess(project.id);
    render();
  }
  search.addEventListener("input", render);
  await refresh();
}
