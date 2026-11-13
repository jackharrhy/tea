import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { render } from "remix/middleware/render";
import { htmlCsp, htmlNoStore } from "./html-security.ts";
import { createController, createRouter } from "remix/router";

import type { Db } from "../src/db/index.ts";
import type { Config } from "../src/config.ts";
import { schema } from "../src/db/index.ts";
import { getAccessibleListIds } from "../src/auth.ts";
import {
  AdminApiAccess,
  AdminDashboard,
  AdminUsers,
  type DashboardData,
} from "./admin.tsx";
import { createAdminListsController } from "./admin-lists.tsx";
import { createAdminTagsController } from "./admin-tags.tsx";
import { createAdminDmarcController } from "./admin-dmarc.tsx";
import { createAdminActivityController } from "./admin-activity.tsx";
import { createAdminSubscribersController } from "./admin-subscribers.tsx";
import { createAdminTemplatesController } from "./admin-templates.tsx";
import { createAdminInboundController } from "./admin-inbound.tsx";
import { createAdminImportController } from "./admin-import.tsx";
import { createAdminCampaignsController } from "./admin-campaigns.tsx";
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

export function createAdminRouter(db: Db, config: Config, user: User) {
  const renderer = render();
  const router = createRouter<AppContext>({
    middleware: [htmlNoStore, htmlCsp, renderer],
  });
  router.map(
    routes.admin,
    createController(routes.admin, {
      actions: {
        dashboard(context) {
          return context.render(
            <AdminDashboard data={dashboardData(db, user)} />,
          );
        },
        users(context) {
          if (user.role !== "owner" && user.role !== "admin")
            return new Response("Forbidden", { status: 403 });
          const users = db
            .select({
              id: schema.users.id,
              name: schema.users.name,
              email: schema.users.email,
              role: schema.users.role,
              authSubject: schema.users.authSubject,
            })
            .from(schema.users)
            .orderBy(schema.users.id)
            .all();
          const assignments = db
            .select({
              userId: schema.userLists.userId,
              count: sql<number>`count(*)`,
            })
            .from(schema.userLists)
            .groupBy(schema.userLists.userId)
            .all();
          const assignmentCounts = new Map(
            assignments.map(({ userId, count: total }) => [userId, total]),
          );
          return context.render(
            <AdminUsers
              viewer={{
                name: user.name ?? user.email,
                isAdmin: true,
              }}
              users={users.map(({ authSubject, ...entry }) => ({
                ...entry,
                linked: Boolean(authSubject),
                listCount: assignmentCounts.get(entry.id) ?? 0,
              }))}
            />,
          );
        },
        tokens(context) {
          return context.render(
            <AdminApiAccess
              viewer={{
                name: user.name ?? user.email,
                isAdmin: user.role === "owner" || user.role === "admin",
              }}
            />,
          );
        },
      },
    }),
  );
  router.map(routes.admin.lists, createAdminListsController(db, config, user));
  router.map(routes.admin.tags, createAdminTagsController(db, user));
  router.map(routes.admin.dmarc, createAdminDmarcController(db, config, user));
  router.map(routes.admin.activity, createAdminActivityController(db, user));
  router.map(
    routes.admin.subscribers,
    createAdminSubscribersController(db, config, user),
  );
  router.map(routes.admin.templates, createAdminTemplatesController(db, user));
  router.map(
    routes.admin.inbound,
    createAdminInboundController(db, config, user),
  );
  router.map(routes.admin.import, createAdminImportController(db, user));
  router.map(
    routes.admin.campaigns,
    createAdminCampaignsController(db, config, user),
  );
  return router;
}
