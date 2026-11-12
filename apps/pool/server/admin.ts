import { roomSettingsPatchSchema } from "@harrhy/pool-protocol";
import { z } from "zod";
import type { Hall } from "./hall";
import type { GameRecorder } from "./recordings";
import type { AuthSession } from "./auth";

type AdminHall = Pick<
  Hall,
  "getRoomSettings" | "setRoomSettings" | "adminPlayers" | "renamePlayer"
>;
type AdminRecorder = Pick<GameRecorder, "metrics" | "audit">;
type AdminAuth = { session(req: Request): Promise<AuthSession | null> };

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function readBody(req: Request): Promise<unknown> {
  if (
    req.headers.get("content-type")?.split(";")[0].trim() !== "application/json"
  )
    return null;
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 4096) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

const renameSchema = z.strictObject({
  id: z.string().refine((value) => value.length >= 1 && value.length <= 100),
  name: z
    .string()
    .refine((value) => !/[\p{Cc}<>]/u.test(value))
    .transform((value) => value.trim())
    .pipe(
      z.string().refine((value) => value.length >= 1 && value.length <= 24),
    ),
});

export function createAdmin(
  hall: AdminHall,
  recorder: AdminRecorder | undefined,
  auth: AdminAuth,
) {
  return {
    async handle(req: Request): Promise<Response | null> {
      const path = new URL(req.url).pathname;
      if (path !== "/api/admin" && !path.startsWith("/api/admin/")) return null;
      const session = await auth.session(req);
      if (session?.owner !== true)
        return json({ error: "Owner access required." }, 403);

      if (req.method !== "GET" && req.method !== "HEAD") {
        const origin = process.env.PUBLIC_ORIGIN;
        if (
          !origin ||
          req.headers.get("Origin") !== origin ||
          !session.csrf ||
          req.headers.get("X-CSRF-Token") !== session.csrf
        )
          return json(
            {
              error: "Origin or CSRF token rejected. Sign in again and retry.",
            },
            403,
          );
      }
      if (path === "/api/admin/state" && req.method === "GET") {
        const players = hall
          .adminPlayers()
          .map(({ id, name, connected, bot }) => ({
            id,
            name,
            connected,
            bot: !!bot,
          }));
        return json({ settings: hall.getRoomSettings(), players });
      }
      if (path === "/api/admin/metrics" && req.method === "GET") {
        if (recorder) {
          try {
            return json(recorder.metrics());
          } catch {
            return json({ error: "Recording metrics are unavailable." }, 503);
          }
        }
        return json({ error: "Recording metrics are unavailable." }, 503);
      }
      if (path === "/api/admin/settings" && req.method === "PATCH") {
        const parsed = roomSettingsPatchSchema.safeParse(await readBody(req));
        if (!parsed.success)
          return json(
            {
              error:
                "Use light intensity 0–3, three gravity values from −15 to 15, and a boolean cutaway.",
            },
            400,
          );
        const patch = parsed.data;
        if (
          !recorder?.audit(session.subject, "room-settings", {
            ...patch,
            phase: "attempt",
          })
        )
          return json(
            {
              error:
                "Owner action auditing is unavailable. No changes applied.",
            },
            503,
          );
        const applied = hall.setRoomSettings({
          ...hall.getRoomSettings(),
          ...patch,
        });
        const status = applied ? 200 : 409;
        const audited = recorder.audit(session.subject, "room-settings", {
          ...patch,
          phase: "outcome",
          applied,
          status,
        });
        const warning = audited
          ? {}
          : {
              auditWarning:
                "The outcome audit could not be saved; the attempt was recorded.",
            };
        return applied
          ? json({ settings: hall.getRoomSettings(), ...warning })
          : json(
              {
                error:
                  "Gravity cannot change while a connected human has an active match.",
                ...warning,
              },
              status,
            );
      }
      if (path === "/api/admin/rename" && req.method === "POST") {
        const parsed = renameSchema.safeParse(await readBody(req));
        if (!parsed.success)
          return json(
            {
              error:
                "Supply a player id and a name of 1–24 characters without control characters or angle brackets.",
            },
            400,
          );
        const { id, name } = parsed.data;
        if (
          !recorder?.audit(session.subject, "rename-player", {
            id,
            name,
            phase: "attempt",
          })
        )
          return json(
            {
              error:
                "Owner action auditing is unavailable. No changes applied.",
            },
            503,
          );
        const applied = hall.renamePlayer(id, name);
        const status = applied ? 200 : 404;
        const audited = recorder.audit(session.subject, "rename-player", {
          id,
          name,
          phase: "outcome",
          applied,
          status,
        });
        const warning = audited
          ? {}
          : {
              auditWarning:
                "The outcome audit could not be saved; the attempt was recorded.",
            };
        return applied
          ? json({ id, name, ...warning })
          : json(
              { error: "Player is no longer in the hall.", ...warning },
              status,
            );
      }
      if (
        [
          "/api/admin/state",
          "/api/admin/metrics",
          "/api/admin/settings",
          "/api/admin/rename",
        ].includes(path)
      )
        return json({ error: "Method not allowed." }, 405);
      return json({ error: "Not found." }, 404);
    },
  };
}
