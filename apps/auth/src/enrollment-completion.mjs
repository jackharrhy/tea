import { randomUUID } from "node:crypto";

const failure = (status, message, code = "enrollment_completion_failed") =>
  Object.assign(new Error(message), { status, code });
const requestIdPattern = /^[A-Za-z0-9_-]{20,64}$/;
const subjectPattern = /^[A-Za-z0-9_-]{1,255}$/;

export function createEnrollmentCompletion({
  api,
  application,
  applications,
  organizationId,
  key,
  request = fetch,
  isBlocked = () => false,
}) {
  const origin = new URL(application.enrollment.apiOrigin);
  const ids = application.enrollment.companionApplications;
  if (
    application.id !== "fourm" ||
    origin.protocol !== "https:" ||
    typeof key !== "string" ||
    key.length < 32 ||
    !Array.isArray(ids) ||
    ids.length !== 2 ||
    new Set(ids).size !== 2 ||
    ids.some((id) => !["maps", "burger"].includes(id))
  )
    throw new Error("Invalid companion enrollment configuration");
  const companions = ids.map((id) => applications.find((app) => app.id === id));
  if (
    companions.some(
      (app) => !app?.projectId || !app.roles?.includes("member"),
    ) ||
    new Set([application.projectId, ...companions.map((app) => app.projectId)])
      .size !== 3
  )
    throw new Error(
      "Companion projects must be distinct reviewed member applications",
    );

  async function source(path, body) {
    let response;
    try {
      response = await request(new URL(path, origin), {
        method: body ? "POST" : "GET",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(12_000),
      });
    } catch {
      throw failure(502, "Enrollment completion service is unavailable.");
    }
    if (!response.ok)
      throw failure(
        [404, 409, 410].includes(response.status) ? 409 : 502,
        "Enrollment completion could not be verified.",
      );
    try {
      return await response.json();
    } catch {
      throw failure(502, "Invalid enrollment completion response.");
    }
  }
  async function grant(subject, projectId) {
    const response = await api("/management/v1/users/grants/_search", {
      management: true,
      method: "POST",
      body: {
        query: { limit: "2" },
        queries: [
          { userIdQuery: { userId: subject } },
          { projectIdQuery: { projectId } },
        ],
      },
    });
    const values = response.result || [];
    if (
      values.length > 1 ||
      values.some(
        (value) => value.userId !== subject || value.projectId !== projectId,
      )
    )
      throw failure(502, "Ambiguous enrollment membership response.");
    return values[0];
  }
  return {
    async complete(input) {
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).toSorted().join(",") !== "requestId,subject" ||
        typeof input.requestId !== "string" ||
        !requestIdPattern.test(input.requestId) ||
        typeof input.subject !== "string" ||
        !subjectPattern.test(input.subject)
      )
        throw failure(400, "Expected an enrollment request and subject only.");
      const { requestId, subject } = input;
      const prefix = `/internal/auth/enrollments/${encodeURIComponent(requestId)}/completion`;
      const proof = await source(prefix);
      if (
        proof.requestId !== requestId ||
        proof.subject !== subject ||
        proof.issuer !== "https://auth.jackharrhy.dev" ||
        proof.completed !== true ||
        proof.createdProfile !== true ||
        proof.enabled !== true ||
        !Number.isSafeInteger(proof.userId) ||
        proof.userId < 1
      )
        throw failure(409, "A committed new member profile is required.");
      let user;
      try {
        user = (
          await api(`/management/v1/users/${encodeURIComponent(subject)}`, {
            management: true,
          })
        ).user;
      } catch (error) {
        if (error.status === 404)
          throw failure(403, "An active verified 4orm member is required.");
        throw error;
      }
      const membership = await grant(subject, application.projectId);
      if (
        !user ||
        user.id !== subject ||
        user.state !== "USER_STATE_ACTIVE" ||
        user.details?.resourceOwner !== organizationId ||
        user.human?.email?.isEmailVerified !== true ||
        membership?.state !== "USER_GRANT_STATE_ACTIVE" ||
        !Array.isArray(membership.roleKeys) ||
        !membership.roleKeys.includes("member")
      )
        throw failure(403, "An active verified 4orm member is required.");
      for (const companion of companions) {
        if (isBlocked(subject, companion.projectId))
          throw failure(
            403,
            "Companion membership is blocked by an administrator.",
          );
        const attemptId = randomUUID();
        const path = `${prefix}/${companion.id}`;
        const reservation = await source(`${path}/reserve`, {
          subject,
          attemptId,
        });
        const bound = (value) =>
          value.requestId === requestId &&
          value.subject === subject &&
          value.applicationId === companion.id;
        if (
          !bound(reservation) ||
          typeof reservation.attemptId !== "string" ||
          !requestIdPattern.test(reservation.attemptId) ||
          !["reserved", "done"].includes(reservation.state)
        )
          throw failure(409, "Conflicting enrollment grant receipt.");
        if (reservation.state === "done") continue;
        let existing = await grant(subject, companion.projectId);
        let outcome = "preserved";
        if (!existing) {
          if (reservation.attemptId !== attemptId)
            throw failure(
              409,
              "Enrollment grant outcome requires operator reconciliation.",
              "enrollment_grant_ambiguous",
            );
          // Persisted reservation precedes the side effect. An uncertain attempt is never replayed.
          await api(
            `/management/v1/users/${encodeURIComponent(subject)}/grants`,
            {
              management: true,
              method: "POST",
              body: { projectId: companion.projectId, roleKeys: ["member"] },
            },
          );
          existing = await grant(subject, companion.projectId);
          if (!existing?.id)
            throw failure(502, "Enrollment grant is not yet observable.");
          outcome = "created";
        }
        let receipt;
        try {
          receipt = await source(`${path}/finish`, {
            subject,
            attemptId: reservation.attemptId,
            grantId: existing.id,
            outcome,
          });
        } catch (error) {
          // A concurrent observer or lost reply may already have committed the terminal receipt.
          receipt = await source(`${path}/reserve`, {
            subject,
            attemptId: reservation.attemptId,
          });
          if (
            !bound(receipt) ||
            receipt.attemptId !== reservation.attemptId ||
            receipt.state !== "done"
          )
            throw error;
        }
        if (
          !bound(receipt) ||
          receipt.attemptId !== reservation.attemptId ||
          receipt.state !== "done"
        )
          throw failure(409, "Enrollment grant acknowledgment is unavailable.");
      }
      return { requestId, completed: true };
    },
  };
}
