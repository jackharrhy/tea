import { createRouter } from "remix/router";

import type { Db } from "../src/db/index.ts";
import { handleSesWebhook } from "../src/services/ses-webhook.ts";

export function createWebhookRouter(db: Db) {
  const router = createRouter();
  router.post("/webhooks/ses", ({ request }) => handleSesWebhook(db, request));
  return router;
}
