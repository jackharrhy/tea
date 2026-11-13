const service = "/zitadel.authorization.v2.AuthorizationService/";

export function createNativeAccess(api, organizationId) {
  const call = (operation, body) =>
    api(service + operation, { management: true, method: "POST", body });
  return {
    async sessions(subject) {
      const sessions = [];
      for (let offset = 0; offset < 10000; offset += 100) {
        const result = await api("/v2/sessions/search", {
          method: "POST",
          body: {
            query: { limit: 100, offset: String(offset) },
            queries: [{ userIdQuery: { id: subject } }],
          },
        });
        const page = result.sessions || [];
        if (page.some((session) => session.factors?.user?.id !== subject))
          throw new Error("Native session inventory escaped its scope");
        sessions.push(
          ...page.filter(
            (session) => Date.parse(session.expirationDate) > Date.now(),
          ),
        );
        if (page.length < 100) return sessions;
      }
      throw new Error("Native session inventory exceeds the supported limit");
    },
    async endSession(subject, id) {
      if (typeof id !== "string" || !/^[A-Za-z0-9-]{1,200}$/.test(id))
        throw Object.assign(new Error("Invalid session"), { status: 400 });
      const { session } = await api(`/v2/sessions/${encodeURIComponent(id)}`);
      if (session?.factors?.user?.id !== subject)
        throw Object.assign(new Error("Session not found"), { status: 404 });
      await api(`/v2/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    async list(subject) {
      const records = [];
      for (let offset = 0; offset < 10000; offset += 100) {
        const result = await call("ListAuthorizations", {
          pagination: { limit: 100, offset: String(offset) },
          filters: [
            { organizationId: { id: organizationId } },
            ...(subject ? [{ inUserIds: { ids: [subject] } }] : []),
          ],
        });
        const page = result.authorizations || [];
        for (const value of page) {
          if (
            value.organization?.id !== organizationId ||
            (subject && value.user?.id !== subject)
          )
            throw new Error("Native role assignment escaped its scope");
          records.push({
            id: value.id,
            userId: value.user.id,
            projectId: value.project.id,
            state:
              value.state === "STATE_ACTIVE"
                ? "USER_GRANT_STATE_ACTIVE"
                : "USER_GRANT_STATE_INACTIVE",
            roleKeys: (value.roles || []).map((role) => role.key).toSorted(),
          });
        }
        if (page.length < 100) return records;
      }
      throw new Error("Role assignment inventory exceeds the supported limit");
    },
    async write(before, after) {
      if (!after.roleKeys.length) {
        if (before) await call("DeleteAuthorization", { id: before.id });
      } else if (!before) {
        await call("CreateAuthorization", {
          userId: after.userId,
          projectId: after.projectId,
          organizationId,
          roleKeys: after.roleKeys,
        });
      } else {
        await call("UpdateAuthorization", {
          id: before.id,
          roleKeys: after.roleKeys,
        });
      }
    },
  };
}
