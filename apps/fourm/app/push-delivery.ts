import { buildPushPayload } from "@block65/webcrypto-web-push";
import type { Bindings, Runtime } from "./runtime.ts";
import type { Row } from "./data/community.ts";
export interface PushDelivery {
  subscription: Row;
  title: string;
  body: string;
  url: string;
}
export async function deliverPush(
  env: Bindings,
  store: Runtime,
  deliveries: PushDelivery[],
  send: typeof fetch = fetch,
) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT)
    return;
  for (const item of deliveries) {
    const sub = item.subscription;
    try {
      const endpoint = String(sub.endpoint);
      const payload = await buildPushPayload(
        { data: { title: item.title, body: item.body, url: item.url } },
        {
          endpoint,
          expirationTime: null,
          keys: { p256dh: String(sub.p256dh_key), auth: String(sub.auth_key) },
        },
        {
          subject: env.VAPID_SUBJECT,
          publicKey: env.VAPID_PUBLIC_KEY,
          privateKey: env.VAPID_PRIVATE_KEY,
        },
      );
      const response = await send(endpoint, {
        ...payload,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      await response.body?.cancel();
      if (response.status === 410)
        await store.call(
          "expirePushSubscription",
          Number(sub.id),
          endpoint,
          String(sub.p256dh_key),
          String(sub.auth_key),
        );
      else if (!response.ok)
        console.error("Push delivery rejected", response.status);
    } catch {
      console.error("Push delivery failed");
    }
  }
}
