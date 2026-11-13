// Disposable enrollment companion to the shared, signed local OIDC issuer.
import { createServer } from "node:http";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";

const origin = process.env.FOURM_FIXTURE_ISSUER;
const app = process.env.FOURM_FIXTURE_APP;
const upstream = process.env.FOURM_FIXTURE_UPSTREAM;
const key = process.env.FOURM_FIXTURE_ENROLLMENT_KEY;
const subject = process.env.FOURM_FIXTURE_SUBJECT ?? "fourm-fixture-jane";
const username = process.env.FOURM_FIXTURE_USERNAME ?? "jane";
if (!origin || !app || !upstream || !key)
  throw new Error("Explicit isolated fixture configuration required");
const grants = new Map();
const completed = new Set();
async function body(request) {
  let text = "";
  for await (const part of request) {
    text += part;
    if (text.length > 16384) throw new Error("Fixture request too large");
  }
  return text;
}
async function service(path, value) {
  const response = await fetch(app + path, {
    method: value ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: value ? JSON.stringify(value) : undefined,
  });
  if (!response.ok) throw new Error(`Enrollment service ${response.status}`);
  return response.json();
}
function send(response, status, value, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    ...headers,
  });
  response.end(JSON.stringify(value));
}
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, origin);
    if (url.pathname === "/enroll" && request.method === "GET") {
      const ticket = url.searchParams.get("ticket") ?? "";
      const [encoded, signature] = ticket.split(".");
      const actual = Buffer.from(signature ?? "", "base64url");
      const expected = createHmac("sha256", key)
        .update(encoded ?? "")
        .digest();
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        return send(response, 400, { error: "Invalid fixture ticket" });
      const payload = JSON.parse(Buffer.from(encoded, "base64url").toString());
      if (
        payload.application !== "fourm" ||
        payload.version !== 1 ||
        payload.expires <= Date.now() / 1000
      )
        return send(response, 400, { error: "Expired fixture ticket" });
      await service(`/internal/auth/enrollments/${payload.requestId}`);
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(
        `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local invite verification</title><main><h1>Local invite verification</h1><p>This fixture supplies a verified subject. No production account or grant is created.</p><form method="post" action="/enroll/continue"><input type="hidden" name="ticket" value="${ticket}"><button>Verify local identity and continue</button></form></main></html>`,
      );
      return;
    }
    if (url.pathname === "/enroll/continue" && request.method === "POST") {
      if (request.headers.origin !== origin)
        return send(response, 403, { error: "Wrong fixture origin" });
      const params = new URLSearchParams(await body(request));
      const ticket = params.get("ticket") ?? "";
      const [encoded, signature] = ticket.split(".");
      const actual = Buffer.from(signature ?? "", "base64url"),
        expected = createHmac("sha256", key)
          .update(encoded ?? "")
          .digest();
      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        return send(response, 400, { error: "Invalid ticket" });
      const payload = JSON.parse(Buffer.from(encoded, "base64url").toString());
      if (payload.expires <= Date.now() / 1000)
        return send(response, 400, { error: "Expired ticket" });
      await service(`/internal/auth/enrollments/${payload.requestId}/claim`, {
        subject,
        username,
        displayName: username,
      });
      response.writeHead(303, { Location: `${app}/auth/start?next=register` });
      response.end();
      return;
    }
    if (url.pathname === "/enroll/complete" && request.method === "POST") {
      if (request.headers.authorization !== `Bearer ${key}`)
        return send(response, 401, { error: "Fixture service key required" });
      const input = JSON.parse(await body(request));
      if (Object.keys(input).toSorted().join(",") !== "requestId,subject")
        return send(response, 400, { error: "Unexpected fields" });
      const proof = await service(
        `/internal/auth/enrollments/${input.requestId}/completion`,
      );
      if (
        !proof.completed ||
        !proof.createdProfile ||
        !proof.enabled ||
        proof.subject !== input.subject
      )
        return send(response, 409, { error: "Not eligible" });
      for (const application of ["maps", "burger"]) {
        const base = `/internal/auth/enrollments/${input.requestId}/completion/${application}`;
        const attemptId = randomUUID();
        const reservation = await service(base + "/reserve", {
          subject: input.subject,
          attemptId,
        });
        if (reservation.state === "done") continue;
        if (
          reservation.attemptId !== attemptId &&
          !grants.has(`${application}:${input.subject}`)
        )
          throw new Error("Ambiguous earlier fixture grant write");
        const grantId =
          grants.get(`${application}:${input.subject}`)?.id ?? randomUUID();
        grants.set(`${application}:${input.subject}`, {
          id: grantId,
          role: "member",
        });
        await service(base + "/finish", {
          subject: input.subject,
          attemptId: reservation.attemptId,
          grantId,
          outcome: "created",
        });
      }
      completed.add(input.requestId);
      return send(response, 200, {
        requestId: input.requestId,
        completed: true,
      });
    }
    if (
      url.pathname === "/fixture/delete-grants" &&
      request.method === "POST"
    ) {
      if (request.headers.authorization !== `Bearer ${key}`)
        return send(response, 401, { error: "Fixture service key required" });
      grants.clear();
      return send(response, 200, { grants: 0 });
    }
    if (url.pathname === "/fixture/grants" && request.method === "GET") {
      if (request.headers.authorization !== `Bearer ${key}`)
        return send(response, 401, { error: "Fixture service key required" });
      return send(response, 200, {
        grants: grants.size,
        roles: Array.from(grants.values(), (grant) => grant.role),
        completedRequests: Array.from(completed),
      });
    }
    const forwarded = await fetch(
      new URL(url.pathname + url.search, upstream),
      {
        method: request.method,
        headers: request.headers,
        body: ["GET", "HEAD"].includes(request.method)
          ? undefined
          : await body(request),
        redirect: "manual",
      },
    );
    response.writeHead(forwarded.status, Object.fromEntries(forwarded.headers));
    response.end(Buffer.from(await forwarded.arrayBuffer()));
  } catch {
    send(response, 409, {
      error: "Local enrollment fixture rejected the request",
    });
  }
});
server.listen(Number(process.env.FOURM_FIXTURE_PORT), "127.0.0.1", () =>
  console.log("Isolated enrollment/OIDC edge ready"),
);
