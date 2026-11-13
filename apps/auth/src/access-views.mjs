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
