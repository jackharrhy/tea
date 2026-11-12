import { CommunityError } from "./data/community.ts";
import type { Bindings, Runtime } from "./runtime.ts";
import { cookie, hash, readCookie } from "./runtime.ts";

function key(env: Bindings) {
  if (!env.AUTH_ENROLLMENT_KEY || env.AUTH_ENROLLMENT_KEY.length < 32)
    throw new CommunityError(503, "Invite enrollment is not configured");
  return env.AUTH_ENROLLMENT_KEY;
}
export async function enrollmentService(request: Request, env: Bindings) {
  const expected = await hash("Bearer " + key(env));
  const given = await hash(request.headers.get("Authorization") ?? "");
  let difference = 0;
  for (let i = 0; i < expected.length; i++)
    difference |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  if (difference)
    throw new CommunityError(401, "Enrollment service authentication required");
}
function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
export async function register(
  request: Request,
  env: Bindings,
  store: Runtime,
) {
  key(env);
  const form = await request.formData();
  const enrollment = await store.call(
    "reserveEnrollment",
    String(form.get("invite_code") ?? "").trim(),
    crypto.randomUUID(),
    readCookie(request, "fourm_enrollment"),
  );
  const payload = base64url(
    new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        application: "fourm",
        requestId: enrollment.id,
        expires: enrollment.expires_at,
      }),
    ),
  );
  const signing = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key(env)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = base64url(
    new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        signing,
        new TextEncoder().encode(payload),
      ),
    ),
  );
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${env.AUTH_ISSUER}/enroll?${new URLSearchParams({ ticket: payload + "." + signature })}`,
      "Set-Cookie": cookie(
        env,
        "fourm_enrollment",
        String(enrollment.id),
        1800,
      ),
    },
  });
}
export async function delivery(
  requestId: string,
  env: Bindings,
  store: Runtime,
) {
  if (!(await store.call("completionDelivery", requestId))) return;
  const proof = await store.call("completionProof", requestId, env.AUTH_ISSUER);
  if (!proof.createdProfile || !proof.enabled) return;
  let status = 502;
  try {
    const response = await fetch(`${env.AUTH_ISSUER}/enroll/complete`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + key(env),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ requestId, subject: proof.subject }),
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    status = response.status;
    if (status === 200) {
      const body = (await response.json()) as Record<string, unknown>;
      if (
        body.requestId !== requestId ||
        body.completed !== true ||
        Object.keys(body).length !== 2
      )
        status = 502;
    }
  } catch {
    /* Profile and invite are committed; the durable event owns retry. */
  }
  return store.call("recordDelivery", requestId, status);
}
export function enrollmentState(row: Record<string, string | number | null>) {
  return {
    requestId: row.id,
    expiresAt: row.expires_at,
    subject: row.subject,
    completed: row.consumed_at !== null,
  };
}
export async function serviceBody(request: Request, keys: string[]) {
  const parsed = await request.json();
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new CommunityError(422, "Invalid enrollment request fields");
  const value = parsed as Record<string, string>;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some(
      (name) =>
        typeof value[name] !== "string" ||
        !value[name] ||
        value[name].length > 255,
    )
  )
    throw new CommunityError(422, "Invalid enrollment request fields");
  if (Object.keys(value).some((name) => !keys.includes(name)))
    throw new CommunityError(422, "Unknown enrollment field");
  for (const name of ["subject", "attemptId", "grantId"]) {
    if (
      value[name] !== undefined &&
      !new RegExp(
        `^[A-Za-z0-9_-]{1,${name === "attemptId" ? 128 : 255}}$`,
      ).test(value[name])
    )
      throw new CommunityError(422, `Invalid ${name}`);
  }
  if (value.displayName?.length > 200)
    throw new CommunityError(422, "Display name is too long");
  return value as Record<string, string>;
}
