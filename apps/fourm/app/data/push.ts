import { CommunityError } from "./community.ts";
import type { Database, Member } from "./community.ts";
export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  device_id: string;
  device_name: string;
}
export function parseSubscription(value: unknown): SubscriptionInput {
  if (!value || typeof value !== "object")
    throw new CommunityError(400, "invalid subscription");
  const body = value as Record<string, unknown>;
  const keys =
    body.keys && typeof body.keys === "object"
      ? (body.keys as Record<string, unknown>)
      : {};
  for (const v of [body.endpoint, body.device_id, keys.p256dh, keys.auth])
    if (typeof v !== "string" || !v)
      throw new CommunityError(400, "invalid subscription");
  if (body.device_name != null && typeof body.device_name !== "string")
    throw new CommunityError(400, "invalid subscription");
  return {
    endpoint: body.endpoint as string,
    device_id: body.device_id as string,
    device_name: (body.device_name as string) ?? "",
    keys: { p256dh: keys.p256dh as string, auth: keys.auth as string },
  };
}
export function createPushDevices(
  db: Database,
  member: (id: number) => Member,
) {
  return {
    subscribePush(actorId: number, input: unknown) {
      member(actorId);
      const sub = parseSubscription(input);
      db.all(
        "INSERT INTO push_subscriptions(user_id,device_id,device_name,endpoint,p256dh_key,auth_key) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,device_id) DO UPDATE SET device_name=excluded.device_name,endpoint=excluded.endpoint,p256dh_key=excluded.p256dh_key,auth_key=excluded.auth_key",
        actorId,
        sub.device_id,
        sub.device_name,
        sub.endpoint,
        sub.keys.p256dh,
        sub.keys.auth,
      );
    },
    pushDevices(actorId: number) {
      member(actorId);
      return db.all(
        "SELECT id,device_id,device_name,created_at FROM push_subscriptions WHERE user_id=?",
        actorId,
      );
    },
    unsubscribePush(actorId: number, deviceId: string) {
      member(actorId);
      if (!deviceId) throw new CommunityError(400, "device_id required");
      db.all(
        "DELETE FROM push_subscriptions WHERE user_id=? AND device_id=?",
        actorId,
        deviceId,
      );
    },
    deletePushDevice(actorId: number, id: number) {
      member(actorId);
      db.all(
        "DELETE FROM push_subscriptions WHERE user_id=? AND id=?",
        actorId,
        id,
      );
    },
  };
}
