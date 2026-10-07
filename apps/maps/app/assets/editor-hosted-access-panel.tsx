import { clientEntry, on, type Handle } from "remix/component";
import type { HostedProjectAccessUser } from "@tea/maps-protocol";
import {
  currentHostedAccessProject,
  listHostedAccess,
  onHostedAccessProjectChange,
  removeHostedAccess,
  setHostedAccessRole,
} from "./editor-hosted-access.ts";

type AccessRole = "editor" | "viewer";

export const EditorHostedAccess = clientEntry(
  `${import.meta.url}#EditorHostedAccess`,
  function EditorHostedAccessComponent(handle: Handle) {
    let projectId: string | null = null;
    let users: readonly HostedProjectAccessUser[] = [];
    let query = "";
    let status = "";
    let pendingUserId: string | null = null;
    let generation = 0;
    const selectedRoles = new Map<string, AccessRole>();

    async function selectProject(next: string | null) {
      const currentGeneration = ++generation;
      projectId = next;
      users = [];
      query = "";
      status = next ? "Loading project access" : "";
      pendingUserId = null;
      selectedRoles.clear();
      handle.update();
      if (!next) return;
      try {
        const listed = await listHostedAccess(next);
        if (currentGeneration !== generation || handle.signal.aborted) return;
        users = listed;
        status = "";
      } catch (cause) {
        if (currentGeneration !== generation || handle.signal.aborted) return;
        status = cause instanceof Error ? cause.message : String(cause);
      }
      handle.update();
    }

    handle.queueTask(() => {
      onHostedAccessProjectChange(
        () => void selectProject(currentHostedAccessProject()),
        handle.signal,
      );
      void selectProject(currentHostedAccessProject());
    });

    async function changeRole(user: HostedProjectAccessUser, remove: boolean) {
      const target = projectId;
      if (!target || pendingUserId) return;
      const currentGeneration = generation;
      pendingUserId = user.id;
      status = "Saving project access";
      handle.update();
      try {
        if (remove) await removeHostedAccess(target, user.id);
        else
          await setHostedAccessRole(
            target,
            user.id,
            selectedRoles.get(user.id) ??
              (user.role === "viewer" ? "viewer" : "editor"),
          );
        const listed = await listHostedAccess(target);
        if (currentGeneration !== generation || handle.signal.aborted) return;
        users = listed;
        selectedRoles.clear();
        status = "";
      } catch (cause) {
        if (currentGeneration !== generation || handle.signal.aborted) return;
        status = cause instanceof Error ? cause.message : String(cause);
      } finally {
        if (currentGeneration === generation && !handle.signal.aborted) {
          pendingUserId = null;
          handle.update();
        }
      }
    }

    return () => {
      const matching = users.filter((user) =>
        `${user.displayName} ${user.username}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      );
      const visible = matching.slice(0, 100);
      const members = users.filter((user) => user.role !== null).length;
      return (
        <details id="hosted-project-access" hidden={!projectId}>
          <summary>Project access</summary>
          <p id="hosted-access-status" role="status">
            {status ||
              `${members} members · showing ${visible.length} of ${matching.length} matching users`}
          </p>
          <label for="hosted-access-search">Find a signed-in user</label>
          <input
            id="hosted-access-search"
            type="search"
            placeholder="Name or username"
            autoComplete="off"
            value={query}
            mix={on<HTMLInputElement>("input", (event) => {
              query = event.currentTarget.value;
              handle.update();
            })}
          />
          <ul id="hosted-access-list">
            {visible.length === 0 ? (
              <li>
                {users.length
                  ? "No users match this search"
                  : "People appear after they sign in to Maps"}
              </li>
            ) : (
              visible.map((user) => (
                <li>
                  <span>
                    {user.displayName} · @{user.username}
                  </span>
                  {user.role === "owner" ? (
                    <strong>Owner</strong>
                  ) : (
                    <span class="hosted-access-actions">
                      <select
                        aria-label={`Access role for ${user.displayName}`}
                        mix={on<HTMLSelectElement>("change", (event) => {
                          selectedRoles.set(
                            user.id,
                            event.currentTarget.value as AccessRole,
                          );
                        })}
                      >
                        <option
                          value="editor"
                          selected={
                            (selectedRoles.get(user.id) ?? user.role) !==
                            "viewer"
                          }
                        >
                          Editor
                        </option>
                        <option
                          value="viewer"
                          selected={
                            (selectedRoles.get(user.id) ?? user.role) ===
                            "viewer"
                          }
                        >
                          Viewer
                        </option>
                      </select>
                      <button
                        type="button"
                        disabled={pendingUserId !== null}
                        mix={on("click", () => void changeRole(user, false))}
                      >
                        {user.role ? "Update" : "Add"}
                      </button>
                      {user.role ? (
                        <button
                          type="button"
                          aria-label={`Remove access for ${user.displayName}`}
                          disabled={pendingUserId !== null}
                          mix={on("click", () => void changeRole(user, true))}
                        >
                          Remove
                        </button>
                      ) : null}
                    </span>
                  )}
                </li>
              ))
            )}
          </ul>
        </details>
      );
    };
  },
);
