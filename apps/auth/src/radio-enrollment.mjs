import { DatabaseSync } from "node:sqlite";
import { chmodSync } from "node:fs";

const denied = () =>
  Object.assign(
    new Error(
      "Radio membership is unavailable. Contact the operator if access was removed.",
    ),
    { status: 403 },
  );
const active = (value) =>
  value?.state === "USER_GRANT_STATE_ACTIVE" &&
  value.roleKeys?.some((role) => ["member", "admin"].includes(role));

export function createRadioEnrollment({
  filename,
  api,
  organizationId,
  isBlocked = () => false,
}) {
  const db = new DatabaseSync(filename);
  chmodSync(filename, 0o600);
  db.exec(`PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS radio_memberships (
      project_id TEXT NOT NULL, subject TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN ('pending','granted','denied')),
      grant_id TEXT, consented_at TEXT NOT NULL,
      PRIMARY KEY(project_id, subject)
    )`);
  const read = db.prepare(
    "SELECT * FROM radio_memberships WHERE project_id=? AND subject=?",
  );
  const pending = new Map();
  async function eligible(subject) {
    if (isBlocked(subject)) throw denied();
    const { user } = await api(
      `/management/v1/users/${encodeURIComponent(subject)}`,
      { management: true },
    );
    if (
      user?.id !== subject ||
      user.state !== "USER_STATE_ACTIVE" ||
      !user.human ||
      user.machine ||
      user.human.email?.isEmailVerified !== true ||
      user.details?.resourceOwner !== organizationId
    )
      throw denied();
  }
  async function grant(application, subject) {
    const response = await api("/management/v1/users/grants/_search", {
      management: true,
      method: "POST",
      body: {
        query: { limit: "2" },
        queries: [
          { userIdQuery: { userId: subject } },
          { projectIdQuery: { projectId: application.projectId } },
        ],
      },
    });
    const values = response.result || [];
    if (
      values.length > 1 ||
      values.some(
        (value) =>
          value.userId !== subject || value.projectId !== application.projectId,
      )
    )
      throw denied();
    return values[0];
  }
  function remember(application, subject, value) {
    db.prepare(
      "INSERT OR IGNORE INTO radio_memberships VALUES (?,?,'granted',?,?)",
    ).run(application.projectId, subject, value.id, new Date().toISOString());
    db.prepare(
      "UPDATE radio_memberships SET state='granted',grant_id=? WHERE project_id=? AND subject=? AND state='pending'",
    ).run(value.id, application.projectId, subject);
  }
  return {
    close: () => db.close(),
    deny(application, subject) {
      if (application.id !== "radio") throw denied();
      db.prepare(
        "INSERT INTO radio_memberships VALUES (?,?,'denied',NULL,?) ON CONFLICT(project_id,subject) DO UPDATE SET state='denied'",
      ).run(application.projectId, subject, new Date().toISOString());
    },
    async approve(application, subject) {
      if (application.id !== "radio") throw denied();
      const current = await grant(application, subject);
      if (!active(current)) throw denied();
      db.prepare(
        "INSERT INTO radio_memberships VALUES (?,?,'granted',?,?) ON CONFLICT(project_id,subject) DO UPDATE SET state='granted',grant_id=excluded.grant_id",
      ).run(
        application.projectId,
        subject,
        current.id,
        new Date().toISOString(),
      );
    },
    async inspect(application, subject) {
      if (
        application.id !== "radio" ||
        application.selfEnrollment !== "verified-organization-human"
      )
        throw denied();
      await eligible(subject);
      if (read.get(application.projectId, subject)?.state === "denied")
        throw denied();
      const current = await grant(application, subject);
      if (active(current)) {
        remember(application, subject, current);
        return false;
      }
      if (current || read.get(application.projectId, subject)) throw denied();
      return true;
    },
    async join(application, subject) {
      const key = JSON.stringify([application.projectId, subject]);
      if (pending.has(key)) return pending.get(key);
      const operation = (async () => {
        if (
          application.id !== "radio" ||
          application.selfEnrollment !== "verified-organization-human"
        )
          throw denied();
        await eligible(subject);
        if (read.get(application.projectId, subject)?.state === "denied")
          throw denied();
        const existing = await grant(application, subject);
        if (active(existing)) {
          remember(application, subject, existing);
          return;
        }
        if (existing) throw denied();
        const reserved = db
          .prepare(
            "INSERT OR IGNORE INTO radio_memberships VALUES (?,?,'pending',NULL,?)",
          )
          .run(application.projectId, subject, new Date().toISOString());
        if (reserved.changes !== 1) throw denied();
        // Reserve before the external write: an unknown outcome can never trigger a second creation.
        await api(
          `/management/v1/users/${encodeURIComponent(subject)}/grants`,
          {
            management: true,
            method: "POST",
            body: { projectId: application.projectId, roleKeys: ["member"] },
          },
        );
        const created = await grant(application, subject);
        if (
          !active(created) ||
          created.roleKeys.length !== 1 ||
          created.roleKeys[0] !== "member"
        )
          throw denied();
        db.prepare(
          "UPDATE radio_memberships SET state='granted',grant_id=? WHERE project_id=? AND subject=? AND state='pending'",
        ).run(created.id, application.projectId, subject);
      })();
      pending.set(key, operation);
      try {
        return await operation;
      } finally {
        pending.delete(key);
      }
    },
  };
}
