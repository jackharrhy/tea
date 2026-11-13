import { escapeHtml as h } from "./security.mjs";
import { page } from "./views.mjs";

const hidden = (name, value) =>
  `<input type="hidden" name="${h(name)}" value="${h(value)}">`;
const nameOf = (user) =>
  user.human?.profile?.displayName || user.userName || "Person";
const statusOf = (user) =>
  ({
    USER_STATE_ACTIVE: "Active",
    USER_STATE_INACTIVE: "Suspended",
    USER_STATE_INITIAL: "Pending",
    USER_STATE_LOCKED: "Locked",
  })[user.state] || "Unknown";
const personPath = (user) => `/manage/people/${encodeURIComponent(user.id)}`;
const form = (context, content, action = "/manage/changes/preview") =>
  `<form method="post" action="${action}" class="form-stack">${hidden("csrf", context.csrf)}${content}</form>`;
const reason =
  '<label>Reason<textarea name="reason" required maxlength="1000" rows="2" placeholder="Why are you making this change?"></textarea></label>';
const pill = (text) => `<span class="status-label">${h(text)}</span>`;
const intro = (title, copy, action = "") =>
  `<div class="page-heading"><div><h1>${h(title)}</h1>${copy ? `<p class="muted">${h(copy)}</p>` : ""}</div>${action}</div>`;
const changeFields = (type, revision) =>
  hidden("type", type) + hidden("revision", revision);
const linkBack = (url, text) =>
  `<a class="text-link" href="${url}">${text}</a>`;

export function person(
  user,
  model,
  applications,
  services,
  observed,
  context,
  recoveryLink,
) {
  const ownGroups = model.memberships
    .filter((item) => item.subject === user.id)
    .map((item) => model.groups.find((group) => group.id === item.group));
  const subjectGrants = observed.filter((item) => item.userId === user.id);
  const projectIds = new Set([
    ...subjectGrants.map((item) => item.projectId),
    ...model.blocks
      .filter((item) => item.subject === user.id)
      .map((item) => item.project),
    ...model.direct
      .filter((item) => item.subject === user.id)
      .map((item) => item.project),
    ...ownGroups
      .flatMap((group) =>
        group.bindings.map(
          (binding) =>
            applications.find((app) => app.id === binding.application)
              ?.projectId,
        ),
      )
      .filter(Boolean),
  ]);
  const sourceRows = (project) => {
    const direct = model.direct
      .filter((item) => item.subject === user.id && item.project === project)
      .map((item) => `${h(item.source)} → ${h(item.role)}`);
    const inherited = ownGroups.flatMap((group) =>
      group.bindings
        .filter(
          (item) =>
            applications.find((app) => app.id === item.application)
              ?.projectId === project,
        )
        .map((item) => `${h(group.name)} → ${h(item.role)}`),
    );
    const recordedRoles = model.direct
      .filter((item) => item.subject === user.id && item.project === project)
      .map((item) => item.role)
      .concat(
        ownGroups.flatMap((group) =>
          group.bindings
            .filter(
              (item) =>
                applications.find((app) => app.id === item.application)
                  ?.projectId === project,
            )
            .map((item) => item.role),
        ),
      );
    const external = (
      subjectGrants.find((grant) => grant.projectId === project)?.roleKeys || []
    )
      .filter((role) => !recordedRoles.includes(role))
      .map((role) => `Unreviewed native change → ${h(role)}`);
    return (
      [...direct, ...inherited, ...external].join("<br>") ||
      "Native assignment outside this model"
    );
  };
  const accessRows = [...projectIds]
    .map((project) => {
      const app = applications.find((item) => item.projectId === project),
        grant = subjectGrants.find((item) => item.projectId === project),
        blocked = model.blocks.some(
          (item) => item.subject === user.id && item.project === project,
        );
      const label = app
        ? services
            .filter((item) => item.applicationId === app.id)
            .map((item) => item.name)
            .join(", ")
        : "External project";
      const support =
        app?.id === "artbin" && context.supportEnabled
          ? context.supportTarget === "ready"
            ? `<span class="table-subline"><a href="${personPath(user)}/support">View as this person</a></span>`
            : `<span class="table-subline">${context.supportTarget === "missing" ? "Needs first Artbin sign-in" : context.supportTarget === "ineligible" ? "View as unavailable" : "Artbin availability could not be checked"}</span>`
          : "";
      return `<tr><td><strong>${h(label)}</strong>${support}</td><td>${pill(blocked ? "Blocked" : !grant ? "Not issued — review needed" : grant.state === "USER_GRANT_STATE_ACTIVE" ? "Issued" : "Inactive")}<span class="table-subline">${h(grant?.roleKeys.join(", ") || "No native roles")}</span></td><td>${sourceRows(project)}</td></tr>`;
    })
    .join("");
  return page(
    nameOf(user),
    intro(
      nameOf(user),
      `${user.userName} · ${statusOf(user)}`,
      `<a class="button" href="${personPath(user)}/preview">Preview auth</a>`,
    ) +
      `<section class="detail-section"><div class="section-heading"><h2>Effective service access</h2><a class="button" href="${personPath(user)}/access">Change access</a></div><p class="muted">Auth administration is separate from every service role. Issued access and native account setup may differ.</p><div class="table-frame"><table><thead><tr><th>Service</th><th>Issued roles</th><th>Why</th></tr></thead><tbody>${accessRows || '<tr><td colspan="3">No service access.</td></tr>'}</tbody></table></div></section><section class="detail-section"><h2>Groups</h2>${ownGroups.map((group) => `<div class="membership-row"><a href="/manage/groups/${group.id}">${h(group.name)}</a>${form(context, changeFields("membership.remove", model.revision) + hidden("subject", user.id) + hidden("group", group.id) + reason + "<button>Review removal</button>")}</div>`).join("") || '<p class="muted">No groups assigned.</p>'}${form(
        context,
        changeFields("membership.add", model.revision) +
          hidden("subject", user.id) +
          `<label>Add to group<select name="group" required><option value="">Choose group</option>${model.groups
            .filter((group) => !ownGroups.includes(group))
            .map(
              (group) =>
                `<option value="${group.id}">${h(group.name)}</option>`,
            )
            .join("")}</select></label>` +
          reason +
          "<button>Review membership</button>",
      )}</section><section class="detail-section"><h2>Account and recovery</h2>${recoveryLink ? `<label>One-use recovery link<input readonly value="${h(recoveryLink)}"></label><p class="hint">Share privately with this person.</p>` : ""}${form(context, "<button>Create recovery link</button>", `/manage/users/${encodeURIComponent(user.id)}/recovery`)}${form(context, hidden("active", String(user.state !== "USER_STATE_ACTIVE")) + `<button${context.user === user.id ? " disabled" : ""}>${user.state === "USER_STATE_LOCKED" ? "Unlock account" : user.state === "USER_STATE_ACTIVE" ? "Suspend account" : "Enable account"}</button>`, `/manage/users/${encodeURIComponent(user.id)}/status`)}<p class="muted">Suspending blocks central sign-in. Existing app sessions and native credentials require separate cleanup. Content and ownership are retained.</p></section>` +
      linkBack("/manage/people", "People"),
    { ...context, active: "people" },
  );
}

export function accessForm(user, model, applications, services, context) {
  return page(
    "Change access",
    intro(
      "Change access",
      `Direct service assignments for ${nameOf(user)}. Group assignments remain independent.`,
    ) +
      applications
        .filter((app) => app.roles.length && !app.authorizationHold)
        .map((app) => {
          const direct = model.direct
            .filter(
              (item) =>
                item.subject === user.id && item.project === app.projectId,
            )
            .map((item) => item.role);
          const blocked = model.blocks.some(
            (item) =>
              item.subject === user.id && item.project === app.projectId,
          );
          const titles =
            services
              .filter((item) => item.applicationId === app.id)
              .map((item) => item.name)
              .join(", ") || app.name;
          const options = [
            ...new Set([
              ...app.roles,
              ...(app.apiRoles || []),
              ...(app.delegatedPermissions || []),
            ]),
          ];
          return `<section class="settings-row"><div><h2>${h(titles)}</h2><p class="muted">${app.id === "media-admin" ? "Shared administration gate. Individual proxy/native provisioning is not implemented." : "These are direct assignments. Unknown existing native role keys are retained."}</p></div><div>${form(context, changeFields("direct.set", model.revision) + hidden("subject", user.id) + hidden("application", app.id) + `<fieldset><legend>Direct roles</legend>${options.map((role) => `<label class="check"><input type="checkbox" name="roles" value="${h(role)}"${direct.includes(role) ? " checked" : ""}>${h(role)}</label>`).join("")}</fieldset>` + reason + "<button>Review direct access</button>")}${form(context, changeFields(blocked ? "service.unblock" : "service.block", model.revision) + hidden("subject", user.id) + hidden("application", app.id) + reason + `<button>${blocked ? "Review unblock" : "Review service block"}</button>`)}</div></section>`;
        })
        .join("") +
      linkBack(personPath(user), "Back to person"),
    { ...context, active: "people" },
  );
}

export function groups(model, context) {
  return page(
    "Groups",
    intro(
      "Groups",
      "Reusable sets of service roles. Groups add together.",
      `<a class="button" href="/manage/groups/new">Create group</a>`,
    ) +
      `<div class="people-list">${model.groups.map((group) => `<a class="group-row" href="/manage/groups/${group.id}"><span><strong>${h(group.name)}</strong><span class="muted">${h(group.description)}</span></span><span>${model.memberships.filter((item) => item.group === group.id).length} people</span><span>${group.id === "auth-administrators" ? "Protected administration" : group.bindings.length + " service roles"}</span></a>`).join("")}</div>`,
    { ...context, active: "groups" },
  );
}

export function groupForm(group, model, applications, users, context) {
  const members = model.memberships.filter((item) => item.group === group?.id);
  const membership = group
    ? `<section class="detail-section"><h2>People</h2>${
        members
          .map((item) => {
            const user = users.find(
              (candidate) => candidate.id === item.subject,
            );
            return `<div class="compact-row"><a href="/manage/people/${encodeURIComponent(item.subject)}">${h(user ? nameOf(user) : "Unavailable identity")}</a></div>`;
          })
          .join("") ||
        '<p class="muted">No members. Creating a group does not add anyone.</p>'
      }</section>`
    : "";
  if (group?.id === "auth-administrators")
    return page(
      group.name,
      intro(group.name, group.description) +
        '<p class="notice">Protected group. Manage membership from each person’s page. Keep at least one active administrator. Membership grants no downstream project roles.</p>' +
        membership,
      { ...context, active: "groups" },
    );
  const bindings = group?.bindings || [];
  const fields = `${changeFields("group.save", model.revision)}${group ? hidden("group", group.id) : ""}<label>Group name<input name="name" required minlength="2" maxlength="80" value="${h(group?.name || "")}"></label><label>Description<textarea name="description" maxlength="500" rows="2">${h(group?.description || "")}</textarea></label><fieldset><legend>Service roles</legend><p class="muted">These are exact service permissions, not a universal role hierarchy.</p><div class="role-options">${applications
    .filter((app) => app.roles.length && !app.authorizationHold)
    .map(
      (app) =>
        `<div><strong>${h(app.name)}</strong>${[...new Set([...app.roles, ...(app.apiRoles || []), ...(app.delegatedPermissions || [])])].map((role) => `<label class="check"><input name="bindings" type="checkbox" value="${h(app.id + "|" + role)}"${bindings.some((item) => item.application === app.id && item.role === role) ? " checked" : ""}>${h(role)}</label>`).join("")}</div>`,
    )
    .join(
      "",
    )}</div></fieldset>${reason}<button class="primary">Review group</button>`;
  return page(
    group?.name || "Create group",
    intro(
      group?.name || "Create group",
      "Preview the affected service roles before applying.",
    ) +
      form(context, fields) +
      membership +
      (group
        ? `<section class="detail-section"><h2>Delete group</h2><p class="muted">Removes this source of access. Independent assignments remain.</p>${form(context, changeFields("group.delete", model.revision) + hidden("group", group.id) + reason + "<button>Review deletion</button>")}</section>`
        : ""),
    { ...context, active: "groups" },
  );
}

export function preview(change, applications, users, context) {
  const personName = (id) => {
    const user = users.find((item) => item.id === id);
    return user ? nameOf(user) : "Person";
  };
  const action = change.change;
  const summary = action.type.startsWith("membership.")
    ? `${action.type === "membership.add" ? "Add" : "Remove"} ${personName(action.subject)} ${action.type === "membership.add" ? "to" : "from"} ${action.groupName}`
    : action.type.startsWith("group.")
      ? `${action.type === "group.delete" ? "Delete" : "Save"} group ${action.name || action.groupName}`
      : `${action.type === "direct.set" ? "Change direct access for" : action.type === "service.block" ? "Block service access for" : "Unblock service access for"} ${personName(action.subject)} · ${applications.find((app) => app.id === action.application)?.name || "Service"}`;
  return page(
    "Review access change",
    intro("Review access change", summary) +
      `<p class="notice">${h(change.change.reason)}</p><section class="detail-section"><h2>Central role changes</h2>${change.effects.length ? `<div class="table-frame"><table><thead><tr><th>Person</th><th>Service</th><th>Before</th><th>After</th></tr></thead><tbody>${change.effects.map((effect) => `<tr><td>${h(personName(effect.after.userId))}</td><td>${h(applications.find((app) => app.projectId === effect.after.projectId)?.name || "Service")}</td><td>${h(effect.before?.roleKeys.join(", ") || "None")}</td><td>${h(effect.after.roleKeys.join(", ") || "None")}</td></tr>`).join("")}</tbody></table></div>` : "<p>Membership or provenance changes only; existing issued roles stay the same.</p>"}<p class="muted">Removing central access may leave app sessions or native credentials active. Those cleanup tasks stay visible.</p></section>${form(context, hidden("operation", change.id) + '<button class="primary">Apply reviewed change</button>', "/manage/changes/apply")}` +
      linkBack("/manage/people", "Cancel and return to People"),
    { ...context, active: "activity" },
  );
}

export function activity(operations, context) {
  return page(
    "Activity & cleanup",
    intro(
      "Activity & cleanup",
      "Changes, verified outcomes, and work that still needs attention.",
    ) +
      `<div class="people-list">${
        operations
          .filter((entry) => entry.state !== "review")
          .map(
            (entry) =>
              `<a class="operation-row" href="/manage/operations/${entry.id}"><span><strong>${h(entry.reason)}</strong><span class="muted">${h(new Date(entry.created_at).toLocaleString("en-GB", { timeZone: "UTC" }))} UTC</span></span>${pill(entry.state.replaceAll("-", " "))}</a>`,
          )
          .join("") || '<p class="empty">No changes applied yet.</p>'
      }</div>`,
    { ...context, active: "activity" },
  );
}

export function operation(value, context) {
  return page(
    "Access operation",
    intro("Access operation", value.reason) +
      `<p>${pill(value.state.replaceAll("-", " "))}</p>${value.state === "unknown" ? '<p class="notice">The provider outcome is uncertain. Do not repeat this change. Inspect the native result without retrying writes.</p>' + form(context, "<button>Verify native outcome</button>", `/manage/operations/${value.id}/reconcile`) : ""}<p>${value.body.completed?.length || 0} of ${value.body.effects.length} native changes verified.</p><section class="detail-section"><h2>External cleanup</h2>${value.body.cleanup?.map((item, index) => `<div class="cleanup-item"><p>${h(item.note)}</p>${pill(item.state)}${item.state !== "verified" ? form(context, hidden("index", index) + '<label>What was checked or cleaned?<textarea name="note" required maxlength="1000" rows="2"></textarea></label><button>Record verified cleanup</button>', `/manage/operations/${value.id}/cleanup`) : ""}</div>`).join("") || '<p class="muted">No removal cleanup recorded for this operation.</p>'}</section>` +
      linkBack("/manage/activity", "Activity & cleanup"),
    { ...context, active: "activity" },
  );
}

export function previewAccount(user, context) {
  return page(
    "Account",
    intro("Account", "") +
      `<dl class="profile"><div><dt>Name</dt><dd>${h(nameOf(user))}</dd></div><div><dt>Username</dt><dd>${h(user.userName)}</dd></div><div><dt>Email</dt><dd>${h(user.human?.email?.email || "Not set")}</dd></div><div><dt>State</dt><dd>${h(statusOf(user))}</dd></div></dl>`,
    { ...context, active: "account" },
  );
}
export function inactivePreview(user, context) {
  return page(
    "Account unavailable",
    intro(
      "Account unavailable",
      `${nameOf(user)} cannot sign in while this account is ${statusOf(user).toLowerCase()}.`,
    ),
    context,
  );
}
