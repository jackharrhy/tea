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
  function deliveries(
    userId: number,
    title: string,
    body: string,
    url: string,
  ) {
    return db
      .all(
        "SELECT p.* FROM push_subscriptions p JOIN users u ON u.id=p.user_id WHERE p.user_id=? AND u.notifications_enabled=1",
        userId,
      )
      .map((subscription) => ({ subscription, title, body, url }));
  }
  return {
    replyNotifications(actorId: number, postId: number) {
      const actor = member(actorId);
      const post = db.all(
        "SELECT p.author_id,p.thread_id,p.quoted_post_id,t.title FROM forum_posts p JOIN forum_threads t ON t.id=p.thread_id WHERE p.id=?",
        postId,
      )[0];
      if (!post || Number(post.author_id) !== actorId)
        throw new CommunityError(403, "Post ownership required");
      const watchers = db.all(
        "SELECT user_id AS id FROM thread_watchers WHERE thread_id=? UNION SELECT id FROM users WHERE watch_all_threads=1",
        post.thread_id,
      );
      const result = watchers
        .filter((u) => Number(u.id) !== actorId)
        .flatMap((u) =>
          deliveries(
            Number(u.id),
            `New reply in ${post.title}`,
            `${actor.display_name} replied`,
            `/forum/${post.thread_id}#post-${postId}`,
          ),
        );
      const quoted = post.quoted_post_id
        ? db.all(
            "SELECT author_id FROM forum_posts WHERE id=?",
            post.quoted_post_id,
          )[0]
        : null;
      if (
        quoted &&
        Number(quoted.author_id) !== actorId &&
        !watchers.some((u) => Number(u.id) === Number(quoted.author_id))
      )
        result.push(
          ...deliveries(
            Number(quoted.author_id),
            `You were quoted in ${post.title}`,
            `${actor.display_name} quoted your post`,
            `/forum/${post.thread_id}#post-${postId}`,
          ),
        );
      return result;
    },
    guestbookNotifications(actorId: number, username: string) {
      const actor = member(actorId);
      const owner = db.all(
        "SELECT id FROM users WHERE username=?",
        username,
      )[0];
      if (!owner || Number(owner.id) === actorId) return [];
      return deliveries(
        Number(owner.id),
        "New guestbook entry",
        `${actor.display_name} signed your guestbook`,
        `/u/${username}/guestbook`,
      );
    },
    expirePushSubscription(
      id: number,
      endpoint: string,
      p256dh: string,
      auth: string,
    ) {
      db.all(
        "DELETE FROM push_subscriptions WHERE id=? AND endpoint=? AND p256dh_key=? AND auth_key=?",
        id,
        endpoint,
        p256dh,
        auth,
      );
    },
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
