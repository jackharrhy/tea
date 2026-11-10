import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { render } from "remix/middleware/render";
import { createController, createRouter } from "remix/router";

import type { Db } from "../src/db/index.ts";
import { schema } from "../src/db/index.ts";
import { getAccessibleListIds } from "../src/auth.ts";
import { AdminDashboard, type DashboardData } from "./admin.tsx";
import type { AppContext } from "./router.tsx";
import { routes } from "./routes.ts";

type User = Pick<
  typeof schema.users.$inferSelect,
  "id" | "role" | "name" | "email"
>;

function count(query: { get(): { count: number } | undefined }) {
  return query.get()?.count ?? 0;
}

function dashboardData(db: Db, user: User): DashboardData {
  const access = getAccessibleListIds(db, user);
  if (access !== "all" && access.length === 0) {
    return {
      name: user.name ?? user.email,
      isAdmin: false,
      subscribers: 0,
      lists: 0,
      campaigns: 0,
      recentCampaigns: [],
    };
  }
  const all = access === "all";
  const subscribers = all
    ? count(
        db
          .select({ count: sql<number>`count(*)` })
          .from(schema.subscribers)
          .where(eq(schema.subscribers.status, "active")),
      )
    : count(
        db
          .select({
            count: sql<number>`count(DISTINCT ${schema.subscribers.id})`,
          })
          .from(schema.subscribers)
          .innerJoin(
            schema.subscriberLists,
            eq(schema.subscriberLists.subscriberId, schema.subscribers.id),
          )
          .where(
            and(
              eq(schema.subscribers.status, "active"),
              inArray(schema.subscriberLists.listId, access),
            ),
          ),
      );
  const lists = all
    ? count(db.select({ count: sql<number>`count(*)` }).from(schema.lists))
    : access.length;
  const campaigns = all
    ? count(db.select({ count: sql<number>`count(*)` }).from(schema.campaigns))
    : count(
        db
          .select({ count: sql<number>`count(*)` })
          .from(schema.campaigns)
          .where(
            and(
              eq(schema.campaigns.audienceType, "list"),
              inArray(schema.campaigns.audienceId, access),
            ),
          ),
      );
  const recentCampaigns = all
    ? db
        .select()
        .from(schema.campaigns)
        .orderBy(desc(schema.campaigns.createdAt))
        .limit(5)
        .all()
    : db
        .select()
        .from(schema.campaigns)
        .where(
          and(
            eq(schema.campaigns.audienceType, "list"),
            inArray(schema.campaigns.audienceId, access),
          ),
        )
        .orderBy(desc(schema.campaigns.createdAt))
        .limit(5)
        .all();
  return {
    name: user.name ?? user.email,
    isAdmin: user.role === "owner" || user.role === "admin",
    subscribers,
    lists,
    campaigns,
    recentCampaigns: recentCampaigns.map(
      ({ id, subject, status, createdAt }) => ({
        id,
        subject,
        status,
        createdAt,
      }),
    ),
  };
}

export function createAdminRouter(db: Db, user: User) {
  const renderer = render();
  const router = createRouter<AppContext>({ middleware: [renderer] });
  router.map(
    routes.admin,
    createController(routes.admin, {
      actions: {
        dashboard(context) {
          return context.render(
            <AdminDashboard data={dashboardData(db, user)} />,
          );
        },
      },
    }),
  );
  return router;
}
