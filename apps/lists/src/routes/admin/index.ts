import { createHttpApp } from "../../http";
import type { Db } from "../../db";
import { schema } from "../../db";
import type { Config } from "../../config";
import { adminAuth } from "../../auth";
import { mountAuthRoutes } from "./auth";
import { mountDashboardRoutes } from "./dashboard";
import { mountSubscriberRoutes } from "./subscribers";
import { mountListRoutes } from "./lists";
import { mountCampaignRoutes } from "./campaigns";
import { mountMessageRoutes } from "./messages";
import { mountActivityRoutes } from "./activity";
import { mountTagRoutes } from "./tags";
import { mountImportRoutes } from "./import";
import { mountUserRoutes } from "./users";
import { mountDmarcRoutes } from "./dmarc";
import { mountTokenRoutes } from "./tokens";
import { mountTemplateRoutes } from "./templates";

export function adminRoutes(
  db: Db,
  config: Config,
  remix?: (
    request: Request,
    user: Pick<
      typeof schema.users.$inferSelect,
      "id" | "role" | "name" | "email"
    >,
  ) => Promise<Response>,
) {
  const app = createHttpApp();

  mountAuthRoutes(app, db, config);

  // Protected routes
  app.use(adminAuth(db));

  mountCampaignRoutes(app, db, config);
  if (remix) app.get("/", (context) => remix(context.request, context.user!));
  else mountDashboardRoutes(app, db, config);
  mountSubscriberRoutes(app, db, config);
  if (remix) {
    for (const path of [
      "/lists",
      "/lists/new",
      "/lists/:id",
      "/lists/:id/edit",
      "/lists/:id/delete",
    ]) {
      app.all(path, (context) => remix(context.request, context.user!));
    }
  } else mountListRoutes(app, db, config);
  mountMessageRoutes(app, db, config);
  mountActivityRoutes(app, db, config);
  if (remix) {
    for (const path of ["/tags", "/tags/new", "/tags/:id", "/tags/:id/delete"])
      app.all(path, (context) => remix(context.request, context.user!));
  } else mountTagRoutes(app, db, config);
  mountImportRoutes(app, db, config);
  if (config.identity && remix) {
    app.get("/users", (context) => remix(context.request, context.user!));
    app.get("/tokens", (context) => remix(context.request, context.user!));
  } else {
    mountUserRoutes(app, db, config);
    mountTokenRoutes(app, db, config);
  }
  if (remix) {
    for (const path of ["/dmarc", "/dmarc/:id", "/dmarc/:id/raw"])
      app.all(path, (context) => remix(context.request, context.user!));
  } else mountDmarcRoutes(app, db, config);
  mountTemplateRoutes(app, db);

  return app;
}
