import { readRequestBody } from "@tea/request-body";
import {
  HostedErrorResponseSchema,
  HostedOkResponseSchema,
} from "@tea/maps-protocol";
import type { z } from "zod";
import type { MapsDatabase, MapsUser } from "./database.js";
import { ServiceHttpError, sessionUser } from "./service-http.js";
import type { WebServiceRequestContext } from "./service-routing.js";

export function webJson<Schema extends z.ZodType>(
  status: number,
  schema: Schema,
  value: z.input<Schema>,
  headers: Headers = new Headers(),
): Response {
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(schema.parse(value)), { status, headers });
}

export function webError(
  status: number,
  message: string,
  headers?: Headers,
): Response {
  return webJson(
    status,
    HostedErrorResponseSchema,
    { error: message.slice(0, 16_384) },
    headers,
  );
}

export function webOk(headers?: Headers): Response {
  return webJson(200, HostedOkResponseSchema, { ok: true }, headers);
}

export function webRedirect(location: string, headers: Headers): Response {
  headers.set("Location", location);
  headers.set("Cache-Control", "no-store");
  return new Response(null, { status: 303, headers });
}

export function appendWebCookie(
  headers: Headers,
  name: string,
  value: string,
  maxAge: number,
  secure: boolean,
): void {
  headers.append(
    "Set-Cookie",
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}${secure ? "; Secure" : ""}`,
  );
}

export function rejectCrossOriginMutation(
  context: WebServiceRequestContext,
): Response | null {
  const site = context.request.headers.get("sec-fetch-site");
  const origin = context.request.headers.get("origin");
  const allowed =
    (!site || site === "same-origin" || site === "none") &&
    (!origin || origin === context.publicOrigin);
  return allowed ? null : webError(403, "Cross-origin mutation rejected");
}

export function requireWebUser(
  context: WebServiceRequestContext,
  database: MapsDatabase,
): MapsUser {
  const user = sessionUser(context, database);
  if (!user) throw new ServiceHttpError(401, "Authentication required");
  return user;
}

export async function webRequestBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  limit = 1024 * 1024,
): Promise<T> {
  const body = await readRequestBody(request, { maxBytes: limit });
  if (!body.ok) {
    throw new ServiceHttpError(
      body.error === "too_large" ? 413 : 400,
      body.error === "too_large"
        ? "Request body is too large"
        : "Request body is invalid",
    );
  }
  let value: unknown;
  try {
    value = body.bytes.length
      ? JSON.parse(new TextDecoder().decode(body.bytes))
      : null;
  } catch {
    throw new ServiceHttpError(400, "Request body contains invalid JSON");
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    const path = result.error.issues[0]?.path.join(".");
    throw new ServiceHttpError(
      400,
      path ? `Request field ${path} is invalid` : "Request body is invalid",
    );
  }
  return result.data;
}

export async function* webBodyChunks(
  request: Request,
): AsyncGenerator<Uint8Array> {
  if (!request.body)
    throw new ServiceHttpError(400, "Request body is required");
  const reader = request.body.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return;
      yield result.value;
    }
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function webErrorFromUnknown(
  error: unknown,
  headers?: Headers,
): Response {
  const candidate =
    typeof error === "object" &&
    error &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : 500;
  const status =
    Number.isInteger(candidate) && candidate >= 400 && candidate <= 599
      ? candidate
      : 500;
  if (status >= 500) console.error(error);
  return webError(
    status,
    status >= 500
      ? "Internal server error"
      : error instanceof Error
        ? error.message
        : String(error),
    headers,
  );
}
