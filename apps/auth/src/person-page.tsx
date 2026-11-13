import { type Handle, type RemixNode } from "remix/component";
import { renderToString } from "remix/component/server";
import { Document, type DocumentProps } from "./document.tsx";

type Context = Omit<DocumentProps, "title" | "children"> & {
  csrf: string; user?: string; supportEnabled?: boolean;
  supportTarget?: "ready" | "missing" | "ineligible" | "unavailable";
};
type Person = { id: string; userName: string; state: string; human?: { profile?: { displayName?: string } } };
type Group = { id: string; name: string; bindings: { application: string; role: string }[] };
type Model = {
  revision: number;
  groups: Group[];
  memberships: { subject: string; group: string }[];
  blocks: { subject: string; project: string }[];
  direct: { subject: string; project: string; role: string; source: string }[];
};
type Application = { id: string; projectId: string };
type Service = { applicationId?: string; name: string };
type Grant = { userId: string; projectId: string; roleKeys: string[]; state: string };

const nameOf = (user: Person) => user.human?.profile?.displayName || user.userName || "Person";
const statusOf = (user: Person) => ({
  USER_STATE_ACTIVE: "Active", USER_STATE_INACTIVE: "Suspended",
  USER_STATE_INITIAL: "Pending", USER_STATE_LOCKED: "Locked",
})[user.state] || "Unknown";

function ChangeForm(handle: Handle<{
  context: Context; revision: number; type: string; userId: string;
  groupId?: string; button: string; children?: RemixNode;
}>) {
  return () => {
    const { context, revision, type, userId, groupId, button } = handle.props;
    return <form method="post" action="/manage/changes/preview" class="form-stack">
      <input type="hidden" name="csrf" value={context.csrf} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="revision" value={String(revision)} />
      <input type="hidden" name="subject" value={userId} />
      {groupId ? <input type="hidden" name="group" value={groupId} /> : null}
      {handle.props.children}
      <label>Reason<textarea name="reason" required maxLength={1000} rows={2} placeholder="Why are you making this change?"></textarea></label>
      <button>{button}</button>
    </form>;
  };
}

function PersonPage(handle: Handle<{
  user: Person; model: Model; applications: Application[]; services: Service[];
  observed: Grant[]; context: Context; recoveryLink?: string;
}>) {
  return () => {
    const { user, model, applications, services, observed, context, recoveryLink } = handle.props;
    const ownGroups = model.memberships.filter((item) => item.subject === user.id)
      .map((item) => model.groups.find((group) => group.id === item.group)).filter((group): group is Group => !!group);
    const subjectGrants = observed.filter((item) => item.userId === user.id);
    const projectIds = new Set([
      ...subjectGrants.map((item) => item.projectId),
      ...model.blocks.filter((item) => item.subject === user.id).map((item) => item.project),
      ...model.direct.filter((item) => item.subject === user.id).map((item) => item.project),
      ...ownGroups.flatMap((group) => group.bindings.map((binding) => applications.find((app) => app.id === binding.application)?.projectId).filter((id): id is string => !!id)),
    ]);
    const projectRows = [...projectIds].map((project) => {
      const app = applications.find((item) => item.projectId === project);
      const grant = subjectGrants.find((item) => item.projectId === project);
      const blocked = model.blocks.some((item) => item.subject === user.id && item.project === project);
      const title = app ? services.filter((item) => item.applicationId === app.id).map((item) => item.name).join(", ") : "External project";
      const direct = model.direct.filter((item) => item.subject === user.id && item.project === project);
      const inherited = ownGroups.flatMap((group) => group.bindings.filter((item) => applications.find((candidate) => candidate.id === item.application)?.projectId === project)
        .map((item) => ({ source: group.name, role: item.role })));
      const recordedRoles = [...direct.map((item) => item.role), ...inherited.map((item) => item.role)];
      const external = (grant?.roleKeys || []).filter((role) => !recordedRoles.includes(role));
      const status = blocked ? "Blocked" : !grant ? "Not issued — review needed" : grant.state === "USER_GRANT_STATE_ACTIVE" ? "Issued" : "Inactive";
      const support = app?.id === "artbin" && context.supportEnabled;
      const supportLabel = context.supportTarget === "missing" ? "Needs first Artbin sign-in" : context.supportTarget === "ineligible" ? "View as unavailable" : "Artbin availability could not be checked";
      return <tr>
        <td><strong>{title}</strong>{support ? <span class="table-subline">{context.supportTarget === "ready" ? <a href={`/manage/people/${encodeURIComponent(user.id)}/support`}>View as this person</a> : supportLabel}</span> : null}</td>
        <td><span class="status-label">{status}</span><span class="table-subline">{grant?.roleKeys.join(", ") || "No native roles"}</span></td>
        <td>{direct.map((item) => <>{item.source} → {item.role}<br /></>)}{inherited.map((item) => <>{item.source} → {item.role}<br /></>)}{external.map((role) => <>Unreviewed native change → {role}<br /></>)}{!direct.length && !inherited.length && !external.length ? "Native assignment outside this model" : null}</td>
      </tr>;
    });
    const personPath = `/manage/people/${encodeURIComponent(user.id)}`;
    return <Document {...context} title={nameOf(user)} active="people">
      <div class="page-heading"><div><h1>{nameOf(user)}</h1><p class="muted">{user.userName} · {statusOf(user)}</p></div><a class="button" href={`${personPath}/preview`}>Preview auth</a></div>
      <section class="detail-section"><div class="section-heading"><h2>Effective service access</h2><a class="button" href={`${personPath}/access`}>Change access</a></div>
        <p class="muted">Auth administration is separate from every service role. Issued access and native account setup may differ.</p>
        <div class="table-frame"><table><thead><tr><th>Service</th><th>Issued roles</th><th>Why</th></tr></thead><tbody>
          {projectRows.length ? projectRows : <tr><td colSpan={3}>No service access.</td></tr>}
        </tbody></table></div>
      </section>
      <section class="detail-section"><h2>Groups</h2>
        {ownGroups.length ? ownGroups.map((group) => <div class="membership-row">
          <a href={`/manage/groups/${group.id}`}>{group.name}</a>
          <ChangeForm context={context} revision={model.revision} type="membership.remove" userId={user.id} groupId={group.id} button="Review removal" />
        </div>) : <p class="muted">No groups assigned.</p>}
        <ChangeForm context={context} revision={model.revision} type="membership.add" userId={user.id} button="Review membership">
          <label>Add to group<select name="group" required><option value="">Choose group</option>
            {model.groups.filter((group) => !ownGroups.includes(group)).map((group) => <option value={group.id}>{group.name}</option>)}
          </select></label>
        </ChangeForm>
      </section>
      <section class="detail-section"><h2>Account and recovery</h2>
        {recoveryLink ? <><label>One-use recovery link<input readOnly value={recoveryLink} /></label><p class="hint">Share privately with this person.</p></> : null}
        <form method="post" action={`/manage/users/${encodeURIComponent(user.id)}/recovery`} class="form-stack"><input type="hidden" name="csrf" value={context.csrf} /><button>Create recovery link</button></form>
        <form method="post" action={`/manage/users/${encodeURIComponent(user.id)}/status`} class="form-stack">
          <input type="hidden" name="csrf" value={context.csrf} /><input type="hidden" name="active" value={String(user.state !== "USER_STATE_ACTIVE")} />
          <button disabled={context.user === user.id}>{user.state === "USER_STATE_LOCKED" ? "Unlock account" : user.state === "USER_STATE_ACTIVE" ? "Suspend account" : "Enable account"}</button>
        </form>
        <p class="muted">Suspending blocks central sign-in. Existing app sessions and native credentials require separate cleanup. Content and ownership are retained.</p>
      </section>
      <a class="text-link" href="/manage/people">People</a>
    </Document>;
  };
}

export const renderPerson = (user: Person, model: Model, applications: Application[], services: Service[], observed: Grant[], context: Context, recoveryLink: string | undefined, nonce: string) => renderToString(<PersonPage user={user} model={model} applications={applications} services={services} observed={observed} context={context} recoveryLink={recoveryLink} />, { nonce });
