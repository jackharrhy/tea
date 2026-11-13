import { createRouter } from "remix/router";
import { route } from "remix/routes";
import { authorizationPolicy, isAuthorizationPath } from "./oidc-policy.mjs";
import { equalToken } from "./security.mjs";

const routes = route({
  enrollmentCompletion: "/enroll/complete",
  authorizationPolicy: "/internal/oidc/authorize-policy",
});

const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

async function readBounded(request, maximum) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request.body || []) {
    size += chunk.byteLength;
    if (size > maximum)
      throw Object.assign(new Error("Request is too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function json(body, status = 200, extra = {}) {
  return Response.json(body, { status, headers: { ...headers, ...extra } });
}

export function createApiRouter({
  enrollmentCompletion,
  enrollmentKey,
  applications,
  origin,
}) {
  const router = createRouter();
  router.map(routes, {
    actions: {
      async enrollmentCompletion({ request }) {
        try {
          if (request.method !== "POST")
            throw Object.assign(new Error("POST required"), { status: 405 });
          if (!enrollmentCompletion)
            throw Object.assign(new Error("Unavailable"), { status: 503 });
          if (
            !equalToken(
              request.headers.get("authorization"),
              `Bearer ${enrollmentKey}`,
            )
          )
            throw Object.assign(new Error("Unauthorized"), { status: 401 });
          if (
            request.headers.get("content-type")?.split(";")[0].trim() !==
            "application/json"
          )
            throw Object.assign(new Error("JSON required"), { status: 415 });
          let input;
          try {
            input = JSON.parse(await readBounded(request, 4096));
          } catch (error) {
            if (error.status === 413) throw error;
            throw Object.assign(new Error("Invalid JSON"), { status: 400 });
          }
          return json(await enrollmentCompletion.complete(input));
        } catch (error) {
          const status =
            Number.isInteger(error.status) &&
            error.status >= 400 &&
            error.status < 600
              ? error.status
              : 502;
          return json(
            {
              error:
                error.code === "enrollment_grant_ambiguous"
                  ? error.code
                  : "enrollment_completion_failed",
            },
            status,
            status === 405 ? { Allow: "POST" } : {},
          );
        }
      },
      async authorizationPolicy({ request }) {
        try {
          const uri = request.headers.get("x-forwarded-uri");
          const method = request.headers.get("x-forwarded-method");
          let body = new URLSearchParams();
          let authorizationPath;
          try {
            authorizationPath =
              typeof uri === "string" && isAuthorizationPath(uri);
          } catch {
            throw Object.assign(
              new Error("Invalid authorization request URI"),
              { status: 400 },
            );
          }
          if (authorizationPath && method === "POST") {
            if (
              !request.headers
                .get("content-type")
                ?.startsWith("application/x-www-form-urlencoded")
            )
              throw Object.assign(new Error("Unsupported authorization form"), {
                status: 415,
              });
            body = new URLSearchParams(await readBounded(request, 16384));
          }
          const policy = authorizationPolicy(uri, method, body, applications);
          const extra = {};
          if (typeof uri === "string") {
            const client =
              new URL(uri, origin).searchParams.get("client_id") ||
              body.get("client_id");
            const minimum = applications
              .map((app) => app.authRequestNotBefore?.[client])
              .find(Boolean);
            if (minimum) extra["X-Jack-Auth-Not-Before"] = minimum;
          }
          return json(policy, policy.allowed ? 200 : 400, extra);
        } catch (error) {
          return json(
            { allowed: false },
            [400, 413, 415].includes(error.status) ? error.status : 502,
          );
        }
      },
    },
  });
  return router;
}

export function isApiRoute(path) {
  return (
    path === "/enroll/complete" || path === "/internal/oidc/authorize-policy"
  );
}
