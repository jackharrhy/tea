import { createRouter } from "remix/router";

import type { Db } from "../src/db/index.ts";
import { handleSesWebhook } from "../src/routes/webhooks.ts";

export function createWebhookRouter(db: Db) {
  const router = createRouter();
  router.post("/webhooks/ses", ({ request }) => handleSesWebhook(db, request));
  return router;
}
