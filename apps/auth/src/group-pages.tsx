import { type Handle } from "remix/component";
import { renderToString } from "remix/component/server";
import { Document, type DocumentProps } from "./document.tsx";

type Context = Omit<DocumentProps, "title" | "children"> & { csrf: string };
type Group = {
  id: string;
  name: string;
  description: string;
  bindings: { application: string; role: string }[];
};
type Model = {
  revision: number;
  groups: Group[];
  memberships: { group: string; subject: string }[];
};
type Application = {
  id: string;
  name: string;
  roles: string[];
  apiRoles?: string[];
  delegatedPermissions?: string[];
  authorizationHold?: boolean;
};
type Person = {
  id: string;
  userName: string;
  human?: { profile?: { displayName?: string } };
};

const nameOf = (user: Person) =>
  user.human?.profile?.displayName || user.userName || "Person";

function GroupsPage(handle: Handle<{ model: Model; context: Context }>) {
  return () => {
    const { model, context } = handle.props;
    return (
      <Document {...context} title="Groups" active="groups">
        <div class="page-heading">
          <div>
            <h1>Groups</h1>
            <p class="muted">
              Reusable sets of service roles. Groups add together.
            </p>
          </div>
          <a class="button" href="/manage/groups/new">
            Create group
          </a>
        </div>
        <div class="people-list">
          {model.groups.map((group) => (
            <a class="group-row" href={`/manage/groups/${group.id}`}>
              <span>
                <strong>{group.name}</strong>
                <span class="muted">{group.description}</span>
              </span>
              <span>
                {
                  model.memberships.filter((item) => item.group === group.id)
                    .length
                }{" "}
                people
              </span>
              <span>
                {group.id === "auth-administrators"
                  ? "Protected administration"
                  : `${group.bindings.length} service roles`}
              </span>
            </a>
          ))}
        </div>
      </Document>
    );
  };
}

function GroupFormPage(
  handle: Handle<{
    group?: Group;
    model: Model;
    applications: Application[];
    users: Person[];
    context: Context;
  }>,
) {
  return () => {
    const { group, model, applications, users, context } = handle.props;
    const members = model.memberships.filter(
      (item) => item.group === group?.id,
    );
    const protectedGroup = group?.id === "auth-administrators";
    const title = group?.name || "Create group";
    return (
      <Document {...context} title={title} active="groups">
        <div class="page-heading">
          <div>
            <h1>{title}</h1>
            <p class="muted">
              {protectedGroup
                ? group?.description
                : "Preview the affected service roles before applying."}
            </p>
          </div>
        </div>
        {protectedGroup ? (
          <p class="notice">
            Protected group. Manage membership from each person’s page. Keep at
            least one active administrator. Membership grants no downstream
            project roles.
          </p>
        ) : (
          <form
            method="post"
            action="/manage/changes/preview"
            class="form-stack"
          >
            <input type="hidden" name="csrf" value={context.csrf} />
            <input type="hidden" name="type" value="group.save" />
            <input
              type="hidden"
              name="revision"
              value={String(model.revision)}
            />
            {group ? (
              <input type="hidden" name="group" value={group.id} />
            ) : null}
            <label>
              Group name
              <input
                name="name"
                required
                minLength={2}
                maxLength={80}
                value={group?.name || ""}
              />
            </label>
            <label>
              Description
              <textarea
                name="description"
                maxLength={500}
                rows={2}
                value={group?.description || ""}
              ></textarea>
            </label>
            <fieldset>
              <legend>Service roles</legend>
              <p class="muted">
                These are exact service permissions, not a universal role
                hierarchy.
              </p>
              <div class="role-options">
                {applications
                  .filter((app) => app.roles.length && !app.authorizationHold)
                  .map((app) => (
                    <div>
                      <strong>{app.name}</strong>
                      {[
                        ...new Set([
                          ...app.roles,
                          ...(app.apiRoles || []),
                          ...(app.delegatedPermissions || []),
                        ]),
                      ].map((role) => (
                        <label class="check">
                          <input
                            name="bindings"
                            type="checkbox"
                            value={`${app.id}|${role}`}
                            checked={
                              group?.bindings.some(
                                (item) =>
                                  item.application === app.id &&
                                  item.role === role,
                              ) || false
                            }
                          />
                          {role}
                        </label>
                      ))}
                    </div>
                  ))}
              </div>
            </fieldset>
            <label>
              Reason
              <textarea
                name="reason"
                required
                maxLength={1000}
                rows={2}
                placeholder="Why are you making this change?"
              ></textarea>
            </label>
            <button class="primary">Review group</button>
          </form>
        )}
        {group ? (
          <section class="detail-section">
            <h2>People</h2>
            {members.length ? (
              members.map((item) => {
                const user = users.find(
                  (candidate) => candidate.id === item.subject,
                );
                return (
                  <div class="compact-row">
                    <a
                      href={`/manage/people/${encodeURIComponent(item.subject)}`}
                    >
                      {user ? nameOf(user) : "Unavailable identity"}
                    </a>
                  </div>
                );
              })
            ) : (
              <p class="muted">
                No members. Creating a group does not add anyone.
              </p>
            )}
          </section>
        ) : null}
        {group && !protectedGroup ? (
          <section class="detail-section">
            <h2>Delete group</h2>
            <p class="muted">
              Removes this source of access. Independent assignments remain.
            </p>
            <form
              method="post"
              action="/manage/changes/preview"
              class="form-stack"
            >
              <input type="hidden" name="csrf" value={context.csrf} />
              <input type="hidden" name="type" value="group.delete" />
              <input
                type="hidden"
                name="revision"
                value={String(model.revision)}
              />
              <input type="hidden" name="group" value={group.id} />
              <label>
                Reason
                <textarea
                  name="reason"
                  required
                  maxLength={1000}
                  rows={2}
                  placeholder="Why are you making this change?"
                ></textarea>
              </label>
              <button>Review deletion</button>
            </form>
          </section>
        ) : null}
      </Document>
    );
  };
}

export const renderGroups = (model: Model, context: Context, nonce: string) =>
  renderToString(<GroupsPage model={model} context={context} />, { nonce });
export const renderGroupForm = (
  group: Group | undefined,
  model: Model,
  applications: Application[],
  users: Person[],
  context: Context,
  nonce: string,
) =>
  renderToString(
    <GroupFormPage
      group={group}
      model={model}
      applications={applications}
      users={users}
      context={context}
    />,
    { nonce },
  );
