// Public-client PKCE enforcement belongs before ZITADEL creates the auth request:
// its Login API does not expose code_challenge and cannot enforce it afterward.
export function isAuthorizationPath(uri) {
  if (typeof uri !== "string" || !uri.startsWith("/") || uri.startsWith("//"))
    return false;
  let path = new URL(uri, "https://auth.invalid").pathname;
  for (let i = 0; i < 3; i++) {
    const decoded = decodeURIComponent(path);
    if (decoded === path) break;
    path = decoded;
  }
  return (
    new URL(path.replace(/\/+/g, "/"), "https://auth.invalid").pathname.replace(
      /\/$/,
      "",
    ) === "/oauth/v2/authorize"
  );
}

export function authorizationPolicy(uri, method, body, applications) {
  const rejected = { allowed: false, error: "invalid_request" };
  if (
    typeof uri !== "string" ||
    uri.length > 16384 ||
    !uri.startsWith("/") ||
    uri.startsWith("//")
  )
    return rejected;
  let isAuthorization;
  try {
    isAuthorization = isAuthorizationPath(uri);
  } catch {
    return rejected;
  }
  if (!isAuthorization) return { allowed: true };
  if (!["GET", "POST"].includes(method)) return rejected;
  const query = new URL(uri, "https://auth.invalid").searchParams;
  const params = new URLSearchParams(query);
  if (method === "POST")
    for (const [key, value] of body) params.append(key, value);
  const clients = params.getAll("client_id");
  const scopes = params.getAll("scope");
  // An unverified request object is inspected only to choose stricter validation,
  // never as authenticated input or as permission to bypass a check.
  for (const request of params.getAll("request")) {
    try {
      const segments = request.split(".");
      if (segments.length !== 3) return rejected;
      const value = JSON.parse(
        Buffer.from(segments[1], "base64url").toString("utf8"),
      );
      if (typeof value.client_id === "string") clients.push(value.client_id);
      if (typeof value.iss === "string") clients.push(value.iss);
      if (typeof value.scope === "string") scopes.push(value.scope);
    } catch {
      return rejected;
    }
  }
  const protectedClients = new Set(
    applications.flatMap((app) => app.pkceClientIds || []),
  );
  const delegatedAudiences = applications
    .filter((app) => app.delegatedRoles?.length)
    .map((app) => `urn:zitadel:iam:org:project:id:${app.projectId}:aud`);
  const required =
    clients.some((client) => protectedClients.has(client)) ||
    scopes.some((scope) =>
      scope.split(/\s+/).some((item) => delegatedAudiences.includes(item)),
    );
  if (!required) return { allowed: true };
  for (const name of [
    "client_id",
    "redirect_uri",
    "response_type",
    "scope",
    "state",
    "nonce",
    "code_challenge",
    "code_challenge_method",
    "request",
    "request_uri",
  ]) {
    if (params.getAll(name).length > 1) return rejected;
  }
  // These migrating clients use ordinary OAuth query/form authorization. A request
  // object would hide the effective parameters from this narrowly scoped check.
  if (
    params.has("request") ||
    params.has("request_uri") ||
    !params.get("client_id") ||
    params.get("response_type") !== "code"
  )
    return rejected;
  if (
    params.get("code_challenge_method") !== "S256" ||
    !/^[A-Za-z0-9_-]{43}$/.test(params.get("code_challenge") || "")
  )
    return rejected;
  return { allowed: true };
}
