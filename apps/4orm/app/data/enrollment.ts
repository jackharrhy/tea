import { usernameReserved } from "./media-moves.ts";
import { CommunityError } from "./community.ts";
import type { Database, Member, Row } from "./community.ts";

const now = () => Math.floor(Date.now() / 1000);
const conflict = (message: string) => new CommunityError(409, message);
function inviteState(invite: Row, pending: number) {
  if (invite.disabled) return "disabled";
  if (invite.expires_at) {
    const date = String(invite.expires_at).replace(" ", "T");
    if (
      Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(date) ? date : date + "Z") <=
      Date.now()
    )
      return "expired";
  }
  if (Number(invite.uses_count) >= Number(invite.max_uses)) return "exhausted";
  if (Number(invite.uses_count) + pending >= Number(invite.max_uses))
    return "reserved";
  return "active";
}
export function createEnrollments(
  db: Database,
  member: (id: number) => Member,
) {
  function pending(requestId: string) {
    const row = db.all(
      `SELECT e.*,i.disabled,i.expires_at AS invite_expiry FROM auth_enrollments e JOIN invites i ON i.id=e.invite_id
      WHERE e.id=?`,
      requestId,
    )[0];
    if (
      !row ||
      Number(row.expires_at) <= now() ||
      row.disabled ||
      (row.invite_expiry && Date.parse(String(row.invite_expiry)) <= Date.now())
    )
      throw conflict("This registration expired or its invite was disabled");
    return row;
  }
  function proof(requestId: string, issuer: string) {
    const row = db.all(
      `SELECT e.*,u.is_disabled,c.issuer AS completion_issuer FROM auth_enrollments e
      JOIN users u ON u.id=e.user_id JOIN external_identities x ON x.user_id=u.id AND x.subject=e.subject AND x.issuer=?
      LEFT JOIN enrollment_completions c ON c.request_id=e.id WHERE e.id=? AND e.consumed_at IS NOT NULL`,
      issuer,
      requestId,
    )[0];
    if (!row) throw conflict("Enrollment has no committed identity");
    return {
      requestId,
      subject: String(row.subject),
      issuer,
      userId: Number(row.user_id),
      completed: true,
      createdProfile: row.completion_issuer === issuer,
      enabled: !row.is_disabled,
    };
  }
  function eligible(
    requestId: string,
    issuer: string,
    application: string,
    subject: string,
  ) {
    const result = proof(requestId, issuer);
    if (
      !result.createdProfile ||
      !result.enabled ||
      result.subject !== subject ||
      !["maps", "burger"].includes(application)
    )
      throw conflict("Enrollment is not eligible for this completion");
  }
  function receipt(requestId: string, application: string, subject: string) {
    const row = db.all(
      "SELECT * FROM enrollment_grants WHERE request_id=? AND application_id=?",
      requestId,
      application,
    )[0];
    if (!row) throw conflict("No completion reservation");
    return {
      requestId,
      subject,
      applicationId: application,
      attemptId: String(row.attempt_id),
      state: row.outcome ? "done" : "reserved",
    };
  }
  return {
    invites(actorId: number) {
      member(actorId);
      return db
        .all(
          `SELECT i.*,(SELECT count(*) FROM auth_enrollments e WHERE e.invite_id=i.id AND e.expires_at>? AND e.consumed_at IS NULL) pending_reservations
        FROM invites i WHERE i.created_by_user_id=? ORDER BY i.created_at DESC`,
          now(),
          actorId,
        )
        .map((row) => {
          const reservationCount = Number(row.pending_reservations);
          const status = inviteState(row, reservationCount);
          return {
            ...row,
            id: Number(row.id),
            code: String(row.code),
            uses_count: Number(row.uses_count),
            max_uses: Number(row.max_uses),
            status,
            pending_reservations: reservationCount,
            redeemed_by: db.all(
              "SELECT username,display_name FROM users WHERE invite_id=?",
              row.id,
            ),
          };
        });
    },
    createInvite(actorId: number, code: string, maxUses: number) {
      member(actorId);
      if (!Number.isSafeInteger(maxUses) || maxUses < 1 || maxUses > 100)
        throw new CommunityError(422, "Invite use limit must be 1–100");
      return db.all(
        "INSERT INTO invites(code,created_by_user_id,max_uses) VALUES(?,?,?) RETURNING *",
        code,
        actorId,
        maxUses,
      )[0];
    },
    disableInvite(actorId: number, id: number) {
      member(actorId);
      db.all(
        "UPDATE invites SET disabled=1 WHERE id=? AND created_by_user_id=?",
        id,
        actorId,
      );
    },
    deleteInvite(actorId: number, id: number) {
      member(actorId);
      db.all(
        `DELETE FROM invites WHERE id=? AND created_by_user_id=? AND uses_count=0
        AND NOT EXISTS(SELECT 1 FROM auth_enrollments e WHERE e.invite_id=invites.id AND e.expires_at>? AND e.consumed_at IS NULL)`,
        id,
        actorId,
        now(),
      );
    },
    reserveEnrollment(
      code: string,
      requestId: string,
      previous: string | null,
    ) {
      return db.transaction(() => {
        if (previous) {
          const row = db.all(
            "SELECT e.* FROM auth_enrollments e JOIN invites i ON i.id=e.invite_id WHERE e.id=? AND i.code=? AND e.consumed_at IS NULL",
            previous,
            code,
          )[0];
          if (row) {
            try {
              return pending(previous);
            } catch {
              /* An expired reservation cannot occupy a new invite slot. */
            }
          }
        }
        const invite = db.all(
          `SELECT i.* FROM invites i WHERE code=? AND disabled=0
          AND (expires_at IS NULL OR julianday(expires_at)>julianday('now'))
          AND uses_count+(SELECT count(*) FROM auth_enrollments e WHERE e.invite_id=i.id AND e.expires_at>? AND e.consumed_at IS NULL)<max_uses`,
          code,
          now(),
        )[0];
        if (!invite)
          throw conflict("This invite is invalid, expired or already in use");
        db.all(
          "INSERT INTO auth_enrollments(id,invite_id,expires_at) VALUES(?,?,?)",
          requestId,
          invite.id,
          now() + 1800,
        );
        return pending(requestId);
      });
    },
    pendingEnrollment: pending,
    claimEnrollment(
      requestId: string,
      issuer: string,
      subject: string,
      username: string,
      displayName: string,
    ) {
      return db.transaction(() => {
        const row = pending(requestId);
        if (
          row.consumed_at !== null ||
          (row.subject && row.subject !== subject)
        )
          throw conflict("This registration is already claimed");
        if (!/^[A-Za-z0-9_-]{1,255}$/.test(subject))
          throw new CommunityError(422, "Invalid subject");
        const existing = db.all(
          "SELECT u.* FROM users u JOIN external_identities x ON x.user_id=u.id WHERE x.issuer=? AND x.subject=?",
          issuer,
          subject,
        )[0];
        if (existing) {
          member(Number(existing.id));
          username = String(existing.username);
          displayName = String(existing.display_name);
        }
        if (!/^[a-z0-9_-]{3,32}$/.test(username))
          throw conflict(
            "Choose 3–32 lowercase letters, numbers, underscores or hyphens",
          );
        const collision = db.all(
          "SELECT id FROM users WHERE username=?",
          username,
        )[0];
        if (
          usernameReserved(db, username) ||
          (collision && collision.id !== existing?.id)
        )
          throw conflict("This username already belongs to another member");
        db.all(
          "UPDATE auth_enrollments SET subject=?,username=?,display_name=? WHERE id=?",
          subject,
          username,
          displayName.slice(0, 80),
          requestId,
        );
        return pending(requestId);
      });
    },
    finishEnrollment(requestId: string, issuer: string, subject: string) {
      return db.transaction(() => {
        const row = pending(requestId);
        if (row.subject !== subject || !row.username)
          throw conflict("Registration belongs to another identity");
        const linked = db.all(
          "SELECT user_id FROM external_identities WHERE issuer=? AND subject=?",
          issuer,
          subject,
        )[0];
        if (row.consumed_at !== null) {
          if (linked?.user_id === row.user_id)
            return member(Number(row.user_id));
          throw conflict("Registration is already complete");
        }
        if (linked) {
          const actor = member(Number(linked.user_id));
          db.all(
            "UPDATE auth_enrollments SET user_id=?,consumed_at=? WHERE id=?",
            actor.id,
            now(),
            requestId,
          );
          return actor;
        }
        if (usernameReserved(db, String(row.username)))
          throw conflict("This username is reserved by a pending rename");
        const invite = db.all(
          "UPDATE invites SET uses_count=uses_count+1,used_at=CURRENT_TIMESTAMP WHERE id=? AND disabled=0 AND uses_count<max_uses RETURNING *",
          row.invite_id,
        )[0];
        if (!invite) throw conflict("This invite is no longer available");
        const user = db.all(
          "INSERT INTO users(username,display_name,password_hash,invited_by_user_id,invite_id) VALUES(?,?,'',?,?) RETURNING id",
          row.username,
          row.display_name,
          invite.created_by_user_id,
          invite.id,
        )[0];
        db.all(
          "INSERT INTO external_identities(issuer,subject,user_id) VALUES(?,?,?)",
          issuer,
          subject,
          user.id,
        );
        db.all(
          "INSERT INTO profile_cards(user_id,headline) VALUES(?,?)",
          user.id,
          `${row.username}'s page`,
        );
        db.all(
          "UPDATE invites SET used_by_user_id=? WHERE id=?",
          user.id,
          invite.id,
        );
        db.all(
          "UPDATE auth_enrollments SET user_id=?,consumed_at=? WHERE id=?",
          user.id,
          now(),
          requestId,
        );
        db.all(
          "INSERT INTO enrollment_completions(request_id,issuer) VALUES(?,?)",
          requestId,
          issuer,
        );
        return member(Number(user.id));
      });
    },
    completionProof: proof,
    reserveGrant(
      requestId: string,
      issuer: string,
      application: string,
      subject: string,
      attemptId: string,
    ) {
      return db.transaction(() => {
        eligible(requestId, issuer, application, subject);
        db.all(
          "INSERT INTO enrollment_grants(request_id,application_id,attempt_id) VALUES(?,?,?) ON CONFLICT DO NOTHING",
          requestId,
          application,
          attemptId,
        );
        return receipt(requestId, application, subject);
      });
    },
    finishGrant(
      requestId: string,
      issuer: string,
      application: string,
      subject: string,
      attemptId: string,
      grantId: string,
      outcome: string,
    ) {
      return db.transaction(() => {
        eligible(requestId, issuer, application, subject);
        const row = db.all(
          "SELECT * FROM enrollment_grants WHERE request_id=? AND application_id=?",
          requestId,
          application,
        )[0];
        if (
          !row ||
          row.attempt_id !== attemptId ||
          !["created", "preserved"].includes(outcome)
        )
          throw conflict("Completion does not own the original reservation");
        if (
          row.outcome &&
          (row.grant_id !== grantId || row.outcome !== outcome)
        )
          throw conflict("Completion receipt is already terminal");
        db.all(
          "UPDATE enrollment_grants SET grant_id=?,outcome=? WHERE request_id=? AND application_id=? AND outcome IS NULL",
          grantId,
          outcome,
          requestId,
          application,
        );
        return receipt(requestId, application, subject);
      });
    },
    pendingCompletions() {
      return db.all(
        "SELECT request_id FROM enrollment_completions WHERE delivered_at IS NULL AND last_status IS NOT 409 ORDER BY request_id LIMIT 100",
      );
    },
    completionDelivery(requestId: string) {
      return (
        db.all(
          "SELECT * FROM enrollment_completions WHERE request_id=? AND delivered_at IS NULL AND last_status IS NOT 409",
          requestId,
        )[0] ?? null
      );
    },
    recordDelivery(requestId: string, status: number) {
      if (
        status === 200 &&
        db.all(
          "SELECT application_id FROM enrollment_grants WHERE request_id=? AND outcome IS NOT NULL",
          requestId,
        ).length !== 2
      )
        status = 502;
      db.all(
        "UPDATE enrollment_completions SET last_status=?,delivered_at=? WHERE request_id=? AND delivered_at IS NULL",
        status,
        status === 200 ? now() : null,
        requestId,
      );
      return status;
    },
  };
}
