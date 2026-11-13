import { randomUUID } from "node:crypto";
import * as views from "./access-views.mjs";
import { directoryFor } from "./directory.mjs";
import { searchAll } from "./applications.mjs";

const fail = (status, message) => Object.assign(new Error(message), { status });

export function createAccessRoutes({
  api,
  applications,
  services,
  integrations,
  access,
  native,
  organizationId,
  accountActions,
  endUserSessions,
  rateLimit,
  supportPreflight,
  renderDirectory,
  renderAppDetail,
  renderSessions,
  renderPeople,
  renderNewPerson,
}) {
  const people = async () =>
    (await searchAll(api, "/management/v1/users/_search")).filter(
      (user) => user.human && user.details?.resourceOwner === organizationId,
    );
  async function handle({
    request,
    url,
    form,
    session,
    profile: _profile,
    context,
    send,
    sendRemix,
    redirect,
  }) {
    if (request.method === "GET" && url.pathname === "/account/sessions") {
      const items = await native.sessions(session.userId);
      await sendRemix((nonce) => renderSessions(items, session.sessionId, context, nonce));
      return true;
    }
    if (request.method === "POST" && url.pathname === "/account/sessions/end") {
      await native.endSession(session.userId, form.get("session"));
      redirect(
        form.get("session") === session.sessionId
          ? "/login"
          : "/account/sessions",
      );
      return true;
    }
    if (
      request.method === "GET" &&
      (url.pathname === "/" || url.pathname.startsWith("/apps/"))
    ) {
      const grants = await native.list(session.userId);
      access.observeUnmanaged(grants);
      const items = directoryFor({
        services,
        applications,
        grants,
        subject: session.userId,
        access,
      });
      if (url.pathname === "/")
        await sendRemix((nonce) => renderDirectory(items, context, nonce));
      else {
        const item = items.find(
          (candidate) => url.pathname === `/apps/${candidate.id}`,
        );
        if (!item)
          throw fail(404, "This app is unavailable or not assigned to you.");
        await sendRemix((nonce) => renderAppDetail(item, context, nonce));
      }
      return true;
    }
    if (!url.pathname.startsWith("/manage")) return false;
    if (!context.admin)
      throw fail(403, "Auth administrator membership is required.");
    const preview = url.pathname.match(
      /^\/manage\/people\/([A-Za-z0-9-]{1,200})\/preview(?:\/(account|apps\/[A-Za-z0-9-]{1,200}))?$/,
    );
    if (preview) {
      if (request.method !== "GET") throw fail(403, "Preview is read only.");
      const target = await accountActions.managedUser(preview[1]);
      const base = `/manage/people/${encodeURIComponent(target.id)}/preview`;
      const previewContext = {
        ...context,
        admin: false,
        preview: {
          base,
          name: target.human?.profile?.displayName || target.userName,
          exit: `/manage/people/${encodeURIComponent(target.id)}`,
        },
      };
      if (target.state !== "USER_STATE_ACTIVE")
        send(views.inactivePreview(target, previewContext));
      else if (preview[2] === "account")
        send(views.previewAccount(target, previewContext));
      else {
        const items = directoryFor({
          services,
          applications,
          grants: await native.list(target.id),
          subject: target.id,
          access,
        });
        if (!preview[2])
          await sendRemix((nonce) => renderDirectory(items, previewContext, nonce));
        else {
          const item = items.find(
            (candidate) => preview[2] === `apps/${candidate.id}`,
          );
          if (!item)
            throw fail(404, "This app is unavailable or not assigned.");
          await sendRemix((nonce) => renderAppDetail(item, previewContext, nonce));
        }
      }
      return true;
    }
    access.observeUnmanaged(await native.list());
    const model = access.read();
    const domains = access.domains();
    if (request.method === "GET" && url.pathname === "/manage") {
      redirect("/manage/people");
      return true;
    }
    if (request.method === "GET" && url.pathname === "/manage/people") {
      const users = await people();
      const filter = {
        q: (url.searchParams.get("q") || "").slice(0, 200),
        state: url.searchParams.get("state") || "all",
      };
      await sendRemix((nonce) => renderPeople(users, model, context, filter, nonce));
      return true;
    }
    if (request.method === "GET" && url.pathname === "/manage/people/new") {
      await sendRemix((nonce) => renderNewPerson(context, nonce));
      return true;
    }
    const person = url.pathname.match(
      /^\/manage\/(?:people|users)\/([A-Za-z0-9-]{1,200})(?:\/(access|recovery|status))?$/,
    );
    if (person) {
      const user = await accountActions.managedUser(person[1]);
      if (request.method === "GET") {
        if (person[2] === "access")
          send(views.accessForm(user, model, domains, services, context));
        else
          send(
            views.person(
              user,
              model,
              domains,
              services,
              await native.list(user.id),
              {
                ...context,
                supportTarget: context.supportEnabled
                  ? await supportPreflight?.(context.user, user.id)
                  : undefined,
              },
            ),
          );
        return true;
      }
      if (request.method === "POST" && person[2] === "recovery") {
        rateLimit(`admin-recovery:${session.userId}:${user.id}`);
        const recoveryLink = await accountActions.recoveryLink(
          user.id,
          new URL(url).origin,
        );
        access.recordAccount(session.userId, user.id, "recovery.created");
        send(
          views.person(
            user,
            model,
            domains,
            services,
            await native.list(user.id),
            context,
            recoveryLink,
          ),
        );
        return true;
      }
      if (request.method === "POST" && person[2] === "status") {
        const next = form.get("active");
        if (!["true", "false"].includes(next))
          throw fail(400, "Invalid account state.");
        if (next === "false" && access.isAdministrator(user.id)) {
          const current = await people();
          if (
            model.memberships.filter(
              (item) =>
                item.group === "auth-administrators" &&
                current.some(
                  (candidate) =>
                    candidate.id === item.subject &&
                    candidate.state === "USER_STATE_ACTIVE",
                ),
            ).length <= 1
          )
            throw fail(409, "Keep at least one active Auth administrator.");
        }
        await accountActions.setActive(user.id, next === "true", user.state);
        access.recordAccount(
          session.userId,
          user.id,
          next === "false" ? "account.suspended" : "account.enabled",
        );
        if (next === "false") await endUserSessions(user.id);
        redirect(`/manage/people/${encodeURIComponent(user.id)}`);
        return true;
      }
    }
    if (request.method === "GET" && url.pathname === "/manage/groups") {
      send(views.groups(model, context));
      return true;
    }
    const group = url.pathname.match(
      /^\/manage\/groups\/([A-Za-z0-9-]{1,200})$/,
    );
    if (request.method === "GET" && group) {
      const value =
        group[1] === "new"
          ? null
          : model.groups.find((item) => item.id === group[1]);
      if (group[1] !== "new" && !value) throw fail(404, "Group not found.");
      send(views.groupForm(value, model, domains, await people(), context));
      return true;
    }
    if (
      request.method === "POST" &&
      url.pathname === "/manage/changes/preview"
    ) {
      const change = {
        type: form.get("type"),
        revision: Number(form.get("revision")),
        reason: form.get("reason"),
        subject: form.get("subject"),
        group: form.get("group"),
        name: form.get("name"),
        description: form.get("description"),
        application: form.get("application"),
        roles: form.getAll("roles"),
        bindings: form.getAll("bindings").map((value) => {
          const parts = value.split("|");
          if (parts.length !== 2) throw fail(400, "Invalid group role.");
          return { application: parts[0], role: parts[1] };
        }),
      };
      const current = await people();
      change.groupName = model.groups.find(
        (candidate) => candidate.id === change.group,
      )?.name;
      if (change.subject) {
        const target = current.find((user) => user.id === change.subject);
        if (!target) throw fail(403, "Choose a human in this organization.");
        if (
          (change.type === "membership.add" ||
            (change.type === "direct.set" && change.roles.length)) &&
          target.state !== "USER_STATE_ACTIVE"
        )
          throw fail(409, "Activate this person before adding access.");
        if (
          change.type === "membership.remove" &&
          change.group === "auth-administrators"
        ) {
          const remaining = model.memberships.filter(
            (item) =>
              item.group === "auth-administrators" &&
              item.subject !== change.subject &&
              current.some(
                (user) =>
                  user.id === item.subject &&
                  user.state === "USER_STATE_ACTIVE",
              ),
          );
          if (!remaining.length)
            throw fail(409, "Keep at least one active Auth administrator.");
        }
      }
      const changePreview = await access.preview(change, session.userId);
      send(views.preview(changePreview, domains, current, context));
      return true;
    }
    if (request.method === "POST" && url.pathname === "/manage/changes/apply") {
      const operation = access.operation(form.get("operation"));
      if (!operation || operation.actor !== session.userId)
        throw fail(404, "Change preview not found.");
      const target = operation.body.change.subject;
      if (target) {
        const user = await accountActions.managedUser(target);
        const change = operation.body.change;
        if (
          (change.type === "membership.add" ||
            (change.type === "direct.set" && change.roles.length)) &&
          user.state !== "USER_STATE_ACTIVE"
        )
          throw fail(409, "This person is not active. Review again.");
        if (
          change.type === "membership.remove" &&
          change.group === "auth-administrators"
        ) {
          const current = await people();
          if (
            !access
              .read()
              .memberships.some(
                (item) =>
                  item.group === "auth-administrators" &&
                  item.subject !== target &&
                  current.some(
                    (candidate) =>
                      candidate.id === item.subject &&
                      candidate.state === "USER_STATE_ACTIVE",
                  ),
              )
          )
            throw fail(409, "Keep at least one active administrator.");
        }
      }
      const result = await access.apply(operation.id, session.userId);
      redirect(`/manage/operations/${result.id}`);
      return true;
    }
    if (request.method === "GET" && url.pathname === "/manage/activity") {
      send(views.activity(access.operations(), context));
      return true;
    }
    const operation = url.pathname.match(
      /^\/manage\/operations\/([A-Za-z0-9-]{1,200})(\/(?:cleanup|reconcile))?$/,
    );
    if (operation) {
      const value = access.operation(operation[1]);
      if (!value) throw fail(404, "Operation not found.");
      if (request.method === "GET") {
        send(views.operation(value, context));
        return true;
      }
      if (request.method === "POST" && operation[2] === "/reconcile") {
        await access.reconcile(value.id, session.userId);
        redirect(`/manage/operations/${value.id}`);
        return true;
      }
      if (request.method === "POST" && operation[2] === "/cleanup") {
        const index = Number(form.get("index"));
        if (!Number.isInteger(index) || index < 0)
          throw fail(400, "Invalid cleanup task.");
        access.completeCleanup(
          value.id,
          index,
          session.userId,
          form.get("note"),
        );
        redirect(`/manage/operations/${value.id}`);
        return true;
      }
    }
    if (request.method === "GET" && url.pathname === "/manage/services") {
      send(views.serviceList(services, domains, context));
      return true;
    }
    if (request.method === "GET" && url.pathname === "/manage/integrations") {
      send(views.integrations(integrations, context));
      return true;
    }
    const service = url.pathname.match(
      /^\/manage\/services\/([A-Za-z0-9-]{1,200})$/,
    );
    if (request.method === "GET" && service) {
      const value = services.find((item) => item.id === service[1]);
      if (!value) throw fail(404, "Service not found.");
      send(
        views.serviceDetail(
          value,
          domains.find((app) => app.id === (value.applicationId || value.id)),
          context,
        ),
      );
      return true;
    }
    if (request.method === "POST" && url.pathname === "/manage/users") {
      const username = form.get("username"),
        name = form.get("name"),
        email = form.get("email"),
        password = form.get("password");
      if (
        !/^[a-z0-9_-]{2,32}$/.test(username || "") ||
        !name ||
        name.length > 100 ||
        !password ||
        password.length < 12 ||
        password.length > 200 ||
        (email && email.length > 250)
      )
        throw fail(
          400,
          "Check the account fields. Passwords need between 12 and 200 characters.",
        );
      rateLimit(`admin-create:${session.userId}`);
      const userId = randomUUID();
      await api("/v2/users/human", {
        method: "POST",
        management: true,
        body: {
          userId,
          username,
          organization: { orgId: organizationId },
          profile: {
            givenName: name.split(" ")[0],
            familyName: name.split(" ").slice(1).join(" ") || "User",
            displayName: name,
          },
          email: {
            email: email || `${username}@pending.invalid`,
            isVerified: false,
          },
          password: { password, changeRequired: false },
        },
      });
      access.recordAccount(session.userId, userId, "account.created");
      redirect("/manage/people");
      return true;
    }
    throw fail(404, "Administration page not found.");
  }
  let pending = Promise.resolve();
  return function dispatch(input) {
    if (
      input.request.method !== "POST" ||
      !input.url.pathname.startsWith("/manage")
    )
      return handle(input);
    if (!access.isAdministrator(input.session.userId))
      throw fail(403, "Auth administrator membership is required.");
    const result = pending.then(async () => {
      const actor = await accountActions.managedUser(input.session.userId);
      if (
        actor.state !== "USER_STATE_ACTIVE" ||
        !access.isAdministrator(actor.id)
      )
        throw fail(403, "Active Auth administrator membership is required.");
      return handle({ ...input, context: { ...input.context, admin: true } });
    });
    pending = result.catch(() => {});
    return result;
  };
}
