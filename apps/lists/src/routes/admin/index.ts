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
  dashboard?: (
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
  if (dashboard)
    app.get("/", (context) => dashboard(context.request, context.user!));
  else mountDashboardRoutes(app, db, config);
  mountSubscriberRoutes(app, db, config);
  mountListRoutes(app, db, config);
  mountMessageRoutes(app, db, config);
  mountActivityRoutes(app, db, config);
  mountTagRoutes(app, db, config);
  mountImportRoutes(app, db, config);
  if (config.identity && dashboard) {
    app.get("/users", (context) => dashboard(context.request, context.user!));
  } else {
    mountUserRoutes(app, db, config);
  }
  mountDmarcRoutes(app, db, config);
  mountTokenRoutes(app, db, config);
  mountTemplateRoutes(app, db);

  return app;
}
