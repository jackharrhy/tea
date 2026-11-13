import { DatabaseSync } from "node:sqlite";
import { chmodSync } from "node:fs";
import { randomUUID } from "node:crypto";

const fail = (status, message) => Object.assign(new Error(message), { status });
const active = (value) => value?.state === "USER_GRANT_STATE_ACTIVE";
const roles = (value) =>
  [...new Set(value || [])].toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const sameRoles = (left, right) =>
  JSON.stringify(roles(left)) === JSON.stringify(roles(right));
const bindingKey = (subject, project) => `${subject}:${project}`;
const signature = (grant) =>
  grant ? JSON.stringify([grant.id, grant.state, roles(grant.roleKeys)]) : null;

export function createAccessStore({
  filename,
  applications,
  services,
  native,
  onIssued = async () => {},
}) {
  const db = new DatabaseSync(filename);
  if (filename !== ":memory:") chmodSync(filename, 0o600);
  db.exec(`PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS access_model (id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,body TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY,actor TEXT NOT NULL,reason TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,body TEXT NOT NULL);
  `);
  db.prepare(
    "UPDATE operations SET state='unknown' WHERE state='applying'",
  ).run();
  const nativeDomains = services
    .filter((service) => service.eligibility)
    .map((service) => ({
      id: service.id,
      name: `${service.name} directory eligibility`,
      projectId: service.eligibility.projectId,
      roles: service.eligibility.roles,
      clientIds: [],
    }));
  const domains = [...applications, ...nativeDomains];
  const application = (id) => domains.find((app) => app.id === id);
  const readModel = () => {
    const row = db
      .prepare("SELECT revision,body FROM access_model WHERE id=1")
      .get();
    return row ? { revision: row.revision, ...JSON.parse(row.body) } : null;
  };
  const saveModel = (model) =>
    db
      .prepare(
        "INSERT INTO access_model VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,body=excluded.body",
      )
      .run(
        model.revision,
        JSON.stringify({
          groups: model.groups,
          memberships: model.memberships,
          direct: model.direct,
          blocks: model.blocks,
          issued: model.issued,
          links: model.links,
        }),
      );
  const transaction = (callback) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
  function assertReady() {
    if (!readModel())
      throw fail(
        503,
        "Access data has not been imported. Contact the operator.",
      );
  }
  function sources(model, subject, project) {
    const result = model.direct
      .filter((item) => item.subject === subject && item.project === project)
      .map((item) => ({
        role: item.role,
        source: item.source || "Direct assignment",
      }));
    for (const membership of model.memberships.filter(
      (item) => item.subject === subject,
    )) {
      const group = model.groups.find((item) => item.id === membership.group);
      for (const item of group?.bindings || [])
        if (application(item.application)?.projectId === project)
          result.push({ role: item.role, source: group.name });
    }
    return result;
  }
  function desired(model, subject, project) {
    if (
      model.blocks.some(
        (item) => item.subject === subject && item.project === project,
      )
    )
      return [];
    return roles(sources(model, subject, project).map((item) => item.role));
  }
  function validateBindings(bindings) {
    if (!Array.isArray(bindings) || bindings.length > 150)
      throw fail(400, "Choose a valid set of service roles.");
    return bindings
      .map((item) => {
        const app = application(item.application);
        const known = [
          ...(app?.roles || []),
          ...(app?.apiRoles || []),
          ...(app?.delegatedPermissions || []),
        ];
        if (
          !app ||
          !known.includes(item.role) ||
          app.authorizationHold ||
          !app.roles.length
        )
          throw fail(400, "This role is unavailable or held.");
        return { application: app.id, role: item.role };
      })
      .filter(
        (item, index, all) =>
          all.findIndex(
            (other) =>
              other.application === item.application &&
              other.role === item.role,
          ) === index,
      );
  }
  function changeModel(model, change, actor) {
    const next = structuredClone(model);
    const group = next.groups.find((item) => item.id === change.group);
    if (
      [
        "membership.add",
        "membership.remove",
        "direct.set",
        "service.block",
        "service.unblock",
      ].includes(change.type) &&
      (typeof change.subject !== "string" ||
        !/^[A-Za-z0-9-]{1,200}$/.test(change.subject))
    )
      throw fail(400, "Choose a valid person.");
    if (
      ["group.delete", "membership.add", "membership.remove"].includes(
        change.type,
      ) &&
      !group
    )
      throw fail(404, "Group not found.");
    if (
      [
        "group.save",
        "group.delete",
        "membership.add",
        "membership.remove",
      ].includes(change.type) &&
      change.group &&
      !group
    )
      throw fail(404, "Group not found.");
    if (change.type === "group.save") {
      const name = String(change.name || "").trim();
      if (name.length < 2 || name.length > 80)
        throw fail(400, "Give the group a name between 2 and 80 characters.");
      if (
        next.groups.some(
          (item) =>
            item.id !== change.group &&
            item.name.toLowerCase() === name.toLowerCase(),
        )
      )
        throw fail(409, "A group already has that name.");
      if (group?.id === "auth-administrators")
        throw fail(
          400,
          "The protected Auth administrators group cannot be renamed or given service roles.",
        );
      const updated = {
        id: group?.id || randomUUID(),
        name,
        description: String(change.description || "").slice(0, 500),
        bindings: validateBindings(change.bindings),
      };
      if (group) next.groups[next.groups.indexOf(group)] = updated;
      else next.groups.push(updated);
    } else if (change.type === "group.delete") {
      if (group.id === "auth-administrators")
        throw fail(400, "Auth administrators cannot be deleted.");
      next.groups = next.groups.filter((item) => item.id !== group.id);
      next.memberships = next.memberships.filter(
        (item) => item.group !== group.id,
      );
    } else if (change.type === "membership.add") {
      if (
        !next.memberships.some(
          (item) => item.group === group.id && item.subject === change.subject,
        )
      )
        next.memberships.push({
          group: group.id,
          subject: change.subject,
          source: "Administrator assignment",
          actor,
        });
    } else if (change.type === "membership.remove") {
      next.memberships = next.memberships.filter(
        (item) => item.group !== group.id || item.subject !== change.subject,
      );
    } else if (change.type === "direct.set") {
      const app = application(change.application);
      if (!app) throw fail(400, "Unknown service.");
      validateBindings(
        (change.roles || []).map((role) => ({
          application: change.application,
          role,
        })),
      );
      const known = [
        ...app.roles,
        ...(app.apiRoles || []),
        ...(app.delegatedPermissions || []),
      ];
      next.direct = next.direct.filter(
        (item) =>
          item.subject !== change.subject ||
          item.project !== app.projectId ||
          !known.includes(item.role),
      );
      for (const role of roles(change.roles))
        next.direct.push({
          subject: change.subject,
          project: app.projectId,
          role,
          source: "Direct assignment",
          actor,
        });
    } else if (["service.block", "service.unblock"].includes(change.type)) {
      const app = application(change.application);
      if (!app) throw fail(400, "Unknown service.");
      next.blocks = next.blocks.filter(
        (item) =>
          item.subject !== change.subject || item.project !== app.projectId,
      );
      if (change.type === "service.block")
        next.blocks.push({
          subject: change.subject,
          project: app.projectId,
          reason: change.reason,
          actor,
        });
    } else throw fail(400, "Unknown access change.");
    if (!next.memberships.some((item) => item.group === "auth-administrators"))
      throw fail(409, "Keep at least one Auth administrator.");
    return next;
  }
  function plan(change, actor, observed) {
    assertReady();
    const model = readModel();
    if (Number(change.revision) !== model.revision)
      throw fail(
        409,
        "Access changed since this page opened. Reload and review again.",
      );
    if (!change.reason?.trim() || change.reason.length > 1000)
      throw fail(400, "Add a short reason for this change.");
    if (
      db
        .prepare(
          "SELECT id FROM operations WHERE state IN ('applying','unknown') LIMIT 1",
        )
        .get()
    )
      throw fail(
        409,
        "An access operation needs reconciliation before another change can run.",
      );
    const next = changeModel(model, change, actor);
    const subjects = new Set(
      [
        ...model.direct,
        ...next.direct,
        ...model.memberships,
        ...next.memberships,
        ...model.blocks,
        ...next.blocks,
      ].map((item) => item.subject),
    );
    const projects = new Set(domains.map((app) => app.projectId));
    const effects = [];
    for (const subject of subjects)
      for (const project of projects) {
        const beforeRoles = desired(model, subject, project),
          afterRoles = desired(next, subject, project);
        if (sameRoles(beforeRoles, afterRoles)) continue;
        const before =
          observed.find(
            (item) => item.userId === subject && item.projectId === project,
          ) || null;
        const recorded = model.issued[bindingKey(subject, project)] || null;
        if (signature(before) !== signature(recorded))
          throw fail(
            409,
            "Provider access changed outside this operation. Reconcile it before applying.",
          );
        if (before && !active(before) && afterRoles.length)
          throw fail(
            409,
            "This native grant is inactive. Explicit native review is required before changing it.",
          );
        if (afterRoles.length) {
          const guarded = services.some(
            (service) =>
              service.assignmentGuard &&
              application(service.applicationId || service.id)?.projectId ===
                project,
          );
          if (
            guarded &&
            !model.links.some(
              (link) =>
                link.subject === subject &&
                link.project === project &&
                afterRoles.every((role) => link.roles.includes(role)),
            )
          )
            throw fail(
              409,
              "This service requires a reviewed native account link. Central access alone would not safely provision it.",
            );
        }
        effects.push({
          before,
          after: {
            userId: subject,
            projectId: project,
            roleKeys: afterRoles,
            state: "USER_GRANT_STATE_ACTIVE",
          },
        });
      }
    return { change, revision: model.revision, next, effects };
  }
  return {
    close: () => db.close(),
    initialized: () => Boolean(readModel()),
    read: () => {
      assertReady();
      return readModel();
    },
    bootstrap({ administrator, grants, links = [] }) {
      if (readModel()) return false;
      if (!administrator)
        throw fail(400, "Reviewed bootstrap administrator required.");
      const model = {
        revision: 1,
        groups: [
          {
            id: "auth-administrators",
            name: "Auth administrators",
            description:
              "Manage identities and service access. No automatic downstream roles.",
            bindings: [],
          },
          {
            id: "fourm-members",
            name: "4orm members",
            description:
              "4orm eligibility and the reviewed Maps/Burger companion access. Native 4orm profile setup is separate.",
            bindings: applications
              .filter((app) => ["fourm", "maps", "burger"].includes(app.id))
              .flatMap((app) =>
                [
                  "member",
                  ...(app.id === "fourm" ? app.apiRoles || [] : []),
                ].map((role) => ({ application: app.id, role })),
              ),
          },
          {
            id: "media-administrators",
            name: "Media administrators",
            description:
              "Shared native administration gate; only reviewed native-linked identities can be assigned.",
            bindings: [{ application: "media-admin", role: "admin" }],
          },
          {
            id: "media-viewers",
            name: "Media viewers",
            description:
              "Jellyfin directory eligibility for reviewed native-linked accounts. Navidrome listeners and Seerr requesters are not provisioned by this group.",
            bindings: nativeDomains
              .filter((domain) => domain.id === "jellyfin")
              .map((domain) => ({ application: domain.id, role: "member" })),
          },
        ],
        memberships: [
          {
            group: "auth-administrators",
            subject: administrator,
            source: "Reviewed operator bootstrap",
          },
        ],
        direct: [],
        blocks: [],
        issued: {},
        links,
      };
      for (const grant of grants) {
        model.issued[bindingKey(grant.userId, grant.projectId)] = grant;
        for (const role of roles(grant.roleKeys))
          model.direct.push({
            subject: grant.userId,
            project: grant.projectId,
            role,
            source: active(grant)
              ? "Imported native assignment"
              : "Imported inactive assignment",
          });
      }
      transaction(() => saveModel(model));
      return true;
    },
    isAdministrator: (subject) =>
      Boolean(
        readModel()?.memberships.some(
          (item) =>
            item.subject === subject && item.group === "auth-administrators",
        ),
      ),
    blocked(subject, project) {
      return Boolean(
        readModel()?.blocks.some(
          (item) => item.subject === subject && item.project === project,
        ),
      );
    },
    domains: () => domains,
    directoryBindings: () =>
      nativeDomains.map((item) => ({
        service: item.id,
        project_id: item.projectId,
        roles: item.roles,
      })),
    sources(subject, project) {
      assertReady();
      return sources(readModel(), subject, project);
    },
    observeUnmanaged(grants, source = "Observed native assignment") {
      if (!readModel()) return;
      transaction(() => {
        const model = readModel();
        let changed = false;
        for (const grant of grants) {
          const key = bindingKey(grant.userId, grant.projectId);
          if (
            model.issued[key] ||
            desired(model, grant.userId, grant.projectId).length ||
            model.blocks.some(
              (item) =>
                item.subject === grant.userId &&
                item.project === grant.projectId,
            )
          )
            continue;
          model.issued[key] = grant;
          for (const role of roles(grant.roleKeys))
            model.direct.push({
              subject: grant.userId,
              project: grant.projectId,
              role,
              source: active(grant) ? source : "Observed inactive assignment",
            });
          changed = true;
        }
        if (changed) {
          model.revision++;
          saveModel(model);
        }
      });
    },
    operations: () =>
      db
        .prepare("SELECT * FROM operations ORDER BY created_at DESC LIMIT 100")
        .all()
        .map((row) => ({ ...row, body: JSON.parse(row.body) })),
    operation(id) {
      const row = db.prepare("SELECT * FROM operations WHERE id=?").get(id);
      return row ? { ...row, body: JSON.parse(row.body) } : null;
    },
    async reconcile(id, actor) {
      const operation = this.operation(id);
      if (!operation || operation.state !== "unknown")
        throw fail(409, "This operation does not need reconciliation.");
      const current = await native.list();
      const matches = operation.body.effects.every((effect) => {
        const observed = current.find(
          (item) =>
            item.userId === effect.after.userId &&
            item.projectId === effect.after.projectId,
        );
        return effect.after.roleKeys.length
          ? active(observed) &&
              sameRoles(observed.roleKeys, effect.after.roleKeys)
          : !observed;
      });
      if (!matches)
        throw fail(
          409,
          "The full intended state is not present. Remaining changes need explicit native operator review; no writes were retried.",
        );
      for (const effect of operation.body.effects) await onIssued(effect);
      transaction(() => {
        const model = readModel();
        for (const effect of operation.body.effects) {
          const observed = current.find(
            (item) =>
              item.userId === effect.after.userId &&
              item.projectId === effect.after.projectId,
          );
          const key = bindingKey(effect.after.userId, effect.after.projectId);
          if (observed) model.issued[key] = observed;
          else delete model.issued[key];
        }
        saveModel(model);
        operation.body.completed = operation.body.effects.map(
          (effect) => effect.after,
        );
        operation.body.reconciledBy = actor;
        operation.body.reconciledAt = new Date().toISOString();
        db.prepare("UPDATE operations SET state=?,body=? WHERE id=?").run(
          operation.body.cleanup.length ? "cleanup-pending" : "complete",
          JSON.stringify(operation.body),
          id,
        );
      });
      return this.operation(id);
    },
    recordAccount(actor, subject, action) {
      const id = randomUUID();
      const cleanup =
        action === "account.suspended"
          ? [
              {
                subject,
                state: "manual-required",
                note: "Central account suspended. Review existing app sessions, native logins and machine credentials; retain content and ownership.",
              },
            ]
          : [];
      const body = {
        change: { type: action, subject },
        effects: [],
        completed: [],
        cleanup,
      };
      db.prepare("INSERT INTO operations VALUES (?,?,?,?,?,?)").run(
        id,
        actor,
        action.replaceAll(".", " "),
        cleanup.length ? "cleanup-pending" : "complete",
        new Date().toISOString(),
        JSON.stringify(body),
      );
      return id;
    },
    async preview(change, actor) {
      const observed = await native.list();
      const result = plan(change, actor, observed),
        id = randomUUID();
      db.prepare("INSERT INTO operations VALUES (?,?,?,'review',?,?)").run(
        id,
        actor,
        change.reason,
        new Date().toISOString(),
        JSON.stringify(result),
      );
      return { id, ...result };
    },
    async apply(id, actor) {
      const operation = this.operation(id);
      if (!operation || operation.actor !== actor)
        throw fail(404, "Change preview not found.");
      if (operation.state !== "review") return operation;
      const observed = await native.list();
      const result = plan(operation.body.change, actor, observed);
      for (const effect of result.effects)
        if (
          signature(effect.before) !==
          signature(
            operation.body.effects.find(
              (item) =>
                item.after.userId === effect.after.userId &&
                item.after.projectId === effect.after.projectId,
            )?.before,
          )
        )
          throw fail(409, "Native state changed. Review again.");
      const body = {
        ...result,
        completed: [],
        cleanup: result.effects
          .filter((effect) =>
            effect.before?.roleKeys.some(
              (role) => !effect.after.roleKeys.includes(role),
            ),
          )
          .map((effect) => ({
            subject: effect.after.userId,
            project: effect.after.projectId,
            state: "manual-required",
            note: "Central removal does not end every app session or native credential. Review the service cleanup contract.",
          })),
      };
      transaction(() => {
        const current = readModel();
        if (current.revision !== result.revision)
          throw fail(409, "Another change was applied. Review again.");
        result.next.revision++;
        saveModel(result.next);
        db.prepare(
          "UPDATE operations SET state='applying',body=? WHERE id=?",
        ).run(JSON.stringify(body), id);
      });
      try {
        for (const effect of result.effects) {
          await native.write(effect.before, effect.after);
          const current =
            (await native.list(effect.after.userId)).find(
              (item) => item.projectId === effect.after.projectId,
            ) || null;
          if (
            effect.after.roleKeys.length
              ? !active(current) ||
                !sameRoles(current.roleKeys, effect.after.roleKeys)
              : current !== null
          )
            throw new Error("Native change could not be verified");
          await onIssued(effect);
          transaction(() => {
            const model = readModel();
            if (current)
              model.issued[
                bindingKey(effect.after.userId, effect.after.projectId)
              ] = current;
            else
              delete model.issued[
                bindingKey(effect.after.userId, effect.after.projectId)
              ];
            saveModel(model);
            body.completed.push(effect.after);
            db.prepare("UPDATE operations SET body=? WHERE id=?").run(
              JSON.stringify(body),
              id,
            );
          });
        }
        db.prepare("UPDATE operations SET state=?,body=? WHERE id=?").run(
          body.cleanup.length ? "cleanup-pending" : "complete",
          JSON.stringify(body),
          id,
        );
      } catch {
        db.prepare(
          "UPDATE operations SET state='unknown',body=? WHERE id=?",
        ).run(JSON.stringify(body), id);
        throw fail(
          502,
          "The change may be partly applied. It is recorded for reconciliation; do not repeat it.",
        );
      }
      return this.operation(id);
    },
    completeCleanup(id, index, actor, note) {
      if (!note?.trim()) throw fail(400, "Record what was checked or cleaned.");
      const operation = this.operation(id);
      if (
        !operation ||
        !["cleanup-pending", "complete"].includes(operation.state) ||
        !operation.body.cleanup[index]
      )
        throw fail(404, "Cleanup task not found.");
      operation.body.cleanup[index] = {
        ...operation.body.cleanup[index],
        state: "verified",
        actor,
        note: note.slice(0, 1000),
        at: new Date().toISOString(),
      };
      db.prepare("UPDATE operations SET state=?,body=? WHERE id=?").run(
        operation.body.cleanup.every((item) => item.state === "verified")
          ? "complete"
          : "cleanup-pending",
        JSON.stringify(operation.body),
        id,
      );
    },
  };
}
