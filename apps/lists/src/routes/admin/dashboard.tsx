/** @jsxRuntime classic */
/** @jsx Html.createElement */
/** @jsxFrag Html.Fragment */
// oxlint-disable-next-line no-unused-vars -- Html is the classic JSX factory.
import { Html } from "@elysia/html";
import type { App } from "../../http";
import { eq, desc, sql, and, inArray } from "drizzle-orm";
import type { Db } from "../../db";
import { schema } from "../../db";
import type { Config } from "../../config";
import { getAccessibleListIds } from "../../auth";
import { AdminLayout, fmtDate, CampaignBadge, type User } from "./layout";
import {
  PageHeader,
  SectionHeading,
  Stat,
  StatGrid,
  Table,
  Th,
  Td,
} from "./ui";

export function mountDashboardRoutes(app: App, db: Db, _config: Config) {
  app.get("/", (c) => {
    const user = c.user as User;
    const listAccess = getAccessibleListIds(db, user);
    let activeCount: number;
    let listCount: number;
    let campaignCount: number;
    let recentCampaigns: (typeof schema.campaigns.$inferSelect)[];

    if (listAccess === "all") {
      activeCount = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.subscribers)
        .where(eq(schema.subscribers.status, "active"))
        .get()!.count;

      listCount = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.lists)
        .get()!.count;

      campaignCount = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.campaigns)
        .get()!.count;

      recentCampaigns = db
        .select()
        .from(schema.campaigns)
        .orderBy(desc(schema.campaigns.createdAt))
        .limit(5)
        .all();
    } else if (listAccess.length === 0) {
      activeCount = 0;
      listCount = 0;
      campaignCount = 0;
      recentCampaigns = [];
    } else {
      activeCount = db
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
            inArray(schema.subscriberLists.listId, listAccess),
          ),
        )
        .get()!.count;

      listCount = listAccess.length;

      campaignCount = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.campaigns)
        .where(
          and(
            eq(schema.campaigns.audienceType, "list"),
            inArray(schema.campaigns.audienceId, listAccess),
          ),
        )
        .get()!.count;

      recentCampaigns = db
        .select()
        .from(schema.campaigns)
        .where(
          and(
            eq(schema.campaigns.audienceType, "list"),
            inArray(schema.campaigns.audienceId, listAccess),
          ),
        )
        .orderBy(desc(schema.campaigns.createdAt))
        .limit(5)
        .all();
    }

    return c.html(
      <AdminLayout title="Dashboard" user={user}>
        <PageHeader title="Dashboard" />
        <StatGrid>
          <Stat label="Subscribers" value={activeCount} />
          <Stat label="Lists" value={listCount} />
          <Stat label="Campaigns" value={campaignCount} />
        </StatGrid>

        <SectionHeading>Recent campaigns</SectionHeading>
        {recentCampaigns.length === 0 ? (
          <p>No campaigns yet.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Subject</Th>
                <Th>Status</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {recentCampaigns.map((cam) => (
                <tr>
                  <Td>
                    <a
                      href={`/admin/campaigns/${cam.id}`}
                      class="text-blue-600 hover:text-blue-800"
                    >
                      {cam.subject}
                    </a>
                  </Td>
                  <Td>
                    <CampaignBadge status={cam.status} />
                  </Td>
                  <Td>{fmtDate(cam.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </AdminLayout>,
    );
  });
}
