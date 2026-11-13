import { type Handle } from "remix/component";
import { renderToString } from "remix/component/server";
import { Document, type DocumentProps } from "./document.tsx";

type Context = Omit<DocumentProps, "title" | "children"> & { csrf: string };
type Person = { id: string; userName: string; human?: { profile?: { displayName?: string } } };
type Application = {
  id: string; name: string; projectId: string; roles: string[];
  apiRoles?: string[]; delegatedPermissions?: string[]; authorizationHold?: boolean;
};
type Service = { applicationId?: string; name: string };
type Model = {
  revision: number;
  direct: { subject: string; project: string; role: string }[];
  blocks: { subject: string; project: string }[];
};
type Change = {
  id: string;
  change: { type: string; subject?: string; groupName?: string; name?: string; application?: string; reason: string };
  effects: {
    before?: { roleKeys: string[] };
    after: { userId: string; projectId: string; roleKeys: string[] };
  }[];
};

const nameOf = (user: Person) => user.human?.profile?.displayName || user.userName || "Person";

function ChangeForm(handle: Handle<{
  context: Context;
  model: Model;
  user: Person;
  application: Application;
  blocked: boolean;
  direct: string[];
  roles: string[];
  title: string;
}>) {
  return () => {
    const { context, model, user, application, blocked, direct, roles, title } = handle.props;
    const hidden = (type: string) => <>
      <input type="hidden" name="csrf" value={context.csrf} />
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="revision" value={String(model.revision)} />
      <input type="hidden" name="subject" value={user.id} />
      <input type="hidden" name="application" value={application.id} />
    </>;
    return <section class="settings-row">
      <div><h2>{title}</h2><p class="muted">{application.id === "media-admin" ? "Shared administration gate. Individual proxy/native provisioning is not implemented." : "These are direct assignments. Unknown existing native role keys are retained."}</p></div>
      <div>
        <form method="post" action="/manage/changes/preview" class="form-stack">
          {hidden("direct.set")}
          <fieldset><legend>Direct roles</legend>{roles.map((role) => <label class="check">
            <input type="checkbox" name="roles" value={role} checked={direct.includes(role)} />{role}
          </label>)}</fieldset>
          <label>Reason<textarea name="reason" required maxLength={1000} rows={2} placeholder="Why are you making this change?"></textarea></label>
          <button>Review direct access</button>
        </form>
        <form method="post" action="/manage/changes/preview" class="form-stack">
          {hidden(blocked ? "service.unblock" : "service.block")}
          <label>Reason<textarea name="reason" required maxLength={1000} rows={2} placeholder="Why are you making this change?"></textarea></label>
          <button>{blocked ? "Review unblock" : "Review service block"}</button>
        </form>
      </div>
    </section>;
  };
}

function AccessFormPage(handle: Handle<{ user: Person; model: Model; applications: Application[]; services: Service[]; context: Context }>) {
  return () => {
    const { user, model, applications, services, context } = handle.props;
    return <Document {...context} title="Change access" active="people">
      <div class="page-heading"><div><h1>Change access</h1><p class="muted">Direct service assignments for {nameOf(user)}. Group assignments remain independent.</p></div></div>
      {applications.filter((app) => app.roles.length && !app.authorizationHold).map((app) => {
        const direct = model.direct.filter((item) => item.subject === user.id && item.project === app.projectId).map((item) => item.role);
        const blocked = model.blocks.some((item) => item.subject === user.id && item.project === app.projectId);
        const title = services.filter((item) => item.applicationId === app.id).map((item) => item.name).join(", ") || app.name;
        const roles = [...new Set([...app.roles, ...(app.apiRoles || []), ...(app.delegatedPermissions || [])])];
        return <ChangeForm context={context} model={model} user={user} application={app} blocked={blocked} direct={direct} roles={roles} title={title} />;
      })}
      <a class="text-link" href={`/manage/people/${encodeURIComponent(user.id)}`}>Back to person</a>
    </Document>;
  };
}

function PreviewPage(handle: Handle<{ change: Change; applications: Application[]; users: Person[]; context: Context }>) {
  return () => {
    const { change, applications, users, context } = handle.props;
    const action = change.change;
    const personName = (id?: string) => users.find((item) => item.id === id)?.human?.profile?.displayName || users.find((item) => item.id === id)?.userName || "Person";
    const summary = action.type.startsWith("membership.")
      ? `${action.type === "membership.add" ? "Add" : "Remove"} ${personName(action.subject)} ${action.type === "membership.add" ? "to" : "from"} ${action.groupName}`
      : action.type.startsWith("group.")
        ? `${action.type === "group.delete" ? "Delete" : "Save"} group ${action.name || action.groupName}`
        : `${action.type === "direct.set" ? "Change direct access for" : action.type === "service.block" ? "Block service access for" : "Unblock service access for"} ${personName(action.subject)} · ${applications.find((app) => app.id === action.application)?.name || "Service"}`;
    return <Document {...context} title="Review access change" active="activity">
      <div class="page-heading"><div><h1>Review access change</h1><p class="muted">{summary}</p></div></div>
      <p class="notice">{action.reason}</p>
      <section class="detail-section"><h2>Central role changes</h2>
        {change.effects.length ? <div class="table-frame"><table><thead><tr><th>Person</th><th>Service</th><th>Before</th><th>After</th></tr></thead><tbody>
          {change.effects.map((effect) => <tr>
            <td>{personName(effect.after.userId)}</td>
            <td>{applications.find((app) => app.projectId === effect.after.projectId)?.name || "Service"}</td>
            <td>{effect.before?.roleKeys.join(", ") || "None"}</td>
            <td>{effect.after.roleKeys.join(", ") || "None"}</td>
          </tr>)}
        </tbody></table></div> : <p>Membership or provenance changes only; existing issued roles stay the same.</p>}
        <p class="muted">Removing central access may leave app sessions or native credentials active. Those cleanup tasks stay visible.</p>
      </section>
      <form method="post" action="/manage/changes/apply" class="form-stack">
        <input type="hidden" name="csrf" value={context.csrf} /><input type="hidden" name="operation" value={change.id} />
        <button class="primary">Apply reviewed change</button>
      </form>
      <a class="text-link" href="/manage/people">Cancel and return to People</a>
    </Document>;
  };
}

export const renderAccessForm = (user: Person, model: Model, applications: Application[], services: Service[], context: Context, nonce: string) => renderToString(<AccessFormPage user={user} model={model} applications={applications} services={services} context={context} />, { nonce });
export const renderChangePreview = (change: Change, applications: Application[], users: Person[], context: Context, nonce: string) => renderToString(<PreviewPage change={change} applications={applications} users={users} context={context} />, { nonce });
