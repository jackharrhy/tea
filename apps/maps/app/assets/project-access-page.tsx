import {
  HostedProjectResponseSchema,
  HostedSessionResponseSchema,
  type HostedProject,
  type HostedProjectAccessUser,
} from "@tea/maps-protocol";
import { clientEntry, on, type Handle } from "remix/component";
import {
  listHostedAccess,
  removeHostedAccess,
  setHostedAccessRole,
} from "./editor-hosted-access.ts";
import { readHostedApi } from "./hosted-api.ts";
import { ProjectDetailHeader } from "./project-detail-header.tsx";

type AccessRole = "editor" | "viewer";

export const ProjectAccess = clientEntry(
  `${import.meta.url}#ProjectAccess`,
  function ProjectAccessComponent(handle: Handle<{ projectId: string }>) {
    let project: HostedProject | null = null;
    let users: readonly HostedProjectAccessUser[] = [];
    let signInRequired = false;
    let query = "";
    let status = "Loading project…";
    let pendingUserId: string | null = null;
    const selectedRoles = new Map<string, AccessRole>();

    handle.queueTask(() => {
      void (async () => {
        try {
          const session = await readHostedApi(
            "/api/session",
            HostedSessionResponseSchema,
          );
          if (!session.user) {
            signInRequired = true;
            status = "Sign in to open this project";
          } else {
            const response = await readHostedApi(
              `/api/projects/${encodeURIComponent(handle.props.projectId)}`,
              HostedProjectResponseSchema,
            );
            project = response.project;
            document.title = `${project.name} · Maps · Tea`;
            status = project.role === "owner" ? "Loading project access" : "";
            handle.update();
            if (project.role === "owner") {
              users = await listHostedAccess(project.id);
              status = "";
            }
          }
        } catch (cause) {
          status = message(cause);
        }
        handle.update();
      })();
    });

    async function changeRole(user: HostedProjectAccessUser, remove: boolean) {
      if (!project || pendingUserId) return;
      pendingUserId = user.id;
      status = "Saving project access";
      handle.update();
      try {
        if (remove) await removeHostedAccess(project.id, user.id);
        else
          await setHostedAccessRole(
            project.id,
            user.id,
            selectedRoles.get(user.id) ??
              (user.role === "viewer" ? "viewer" : "editor"),
          );
        users = await listHostedAccess(project.id);
        selectedRoles.clear();
        status = "";
      } catch (cause) {
        status = message(cause);
      } finally {
        pendingUserId = null;
        handle.update();
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
        <section class="project-detail">
          <p id="projects-status" role="status">
            {status}
          </p>
          {signInRequired ? (
            <a
              id="projects-login"
              href={`/auth/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`}
              data-rmx-document
            >
              Sign in
            </a>
          ) : null}
          {project ? (
            <div>
              <ProjectDetailHeader project={project} section="access" />
              <h2>Access</h2>
              {project.role === "owner" ? (
                <div>
                  <p>
                    Grant editor or viewer access to people who have signed in
                    to Maps.
                  </p>
                  <label for="project-access-search">Search people</label>
                  <input
                    id="project-access-search"
                    type="search"
                    autocomplete="off"
                    defaultValue={query}
                    mix={on<HTMLInputElement>("input", (event) => {
                      query = event.currentTarget.value;
                      handle.update();
                    })}
                  />
                  <p id="project-access-status" role="status">
                    {status ||
                      `${members} members · showing ${visible.length} of ${matching.length} matching users`}
                  </p>
                  <div id="project-access-list" class="project-list">
                    {visible.length === 0
                      ? users.length
                        ? "No users match this search"
                        : "People appear after they sign in to Maps"
                      : visible.map((user) => (
                          <div class="project-row">
                            <strong>
                              {user.displayName} · @{user.username}
                            </strong>
                            {user.role === "owner" ? (
                              <span>Owner</span>
                            ) : (
                              <div class="project-actions">
                                <select
                                  aria-label={`Access role for ${user.displayName}`}
                                  defaultValue={
                                    selectedRoles.get(user.id) ??
                                    (user.role === "viewer"
                                      ? "viewer"
                                      : "editor")
                                  }
                                  mix={on<HTMLSelectElement>(
                                    "change",
                                    (event) => {
                                      selectedRoles.set(
                                        user.id,
                                        event.currentTarget.value as AccessRole,
                                      );
                                    },
                                  )}
                                >
                                  <option value="editor">Editor</option>
                                  <option value="viewer">Viewer</option>
                                </select>
                                <button
                                  type="button"
                                  disabled={pendingUserId !== null}
                                  mix={on(
                                    "click",
                                    () => void changeRole(user, false),
                                  )}
                                >
                                  {user.role ? "Update" : "Add"}
                                </button>
                                {user.role ? (
                                  <button
                                    type="button"
                                    aria-label={`Remove access for ${user.displayName}`}
                                    disabled={pendingUserId !== null}
                                    mix={on(
                                      "click",
                                      () => void changeRole(user, true),
                                    )}
                                  >
                                    Remove
                                  </button>
                                ) : null}
                              </div>
                            )}
                          </div>
                        ))}
                  </div>
                </div>
              ) : (
                <p id="project-access-status" role="status">
                  Only the project owner can manage access
                </p>
              )}
            </div>
          ) : null}
        </section>
      );
    };
  },
);

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
