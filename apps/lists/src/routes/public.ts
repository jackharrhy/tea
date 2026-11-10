import { createListsRouter } from "../../app/router.tsx";
import type { Config } from "../config.ts";
import type { Db } from "../db/index.ts";
import { createHttpApp } from "../http.ts";

export function publicRoutes(db: Db, config: Config) {
  const router = createListsRouter(db, config);
  const forward = ({ request }: { request: Request }) => router.fetch(request);
  return createHttpApp()
    .get("/subscribe", forward)
    .post("/subscribe", forward)
    .get("/confirm/:token/:domain", forward)
    .get("/confirm/:token", forward)
    .get("/unsubscribe/:token/:listId", forward)
    .post("/unsubscribe/:token/:listId", forward)
    .get("/unsubscribe/:token", forward)
    .post("/unsubscribe/:token", forward)
    .get("/preferences/:token", forward)
    .post("/preferences/:token", forward);
}
