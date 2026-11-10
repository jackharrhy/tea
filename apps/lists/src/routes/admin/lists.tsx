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
import { canAccessList, getAccessibleLists } from "../../auth";
import { idInput } from "../../operations/contracts";
import { z } from "zod";
import { logEvent } from "../../services/events";
import {
  AdminLayout,
  displayName,
  fmtDate,
  fmtDateTime,
  CampaignBadge,
  setFlash,
  getFlash,
  type User,
} from "./layout";
import {
  Button,
  LinkButton,
  Input,
  Label,
  FormGroup,
  Table,
  Th,
  Td,
  Card,
  PageHeader,
} from "./ui";

const listFormInput = z
  .object({
    slug: z.string(),
    name: z.string(),
    description: z.string().optional(),
    fromDomain: z.string().optional(),
    fromAddress: z.string().optional(),
  })
  .strict();

export function mountListRoutes(app: App, db: Db, config: Config) {
  app.get("/lists", (c) => {
    const user = c.user as User;
    const flash = getFlash(c);
    const isAdmin = user.role === "owner" || user.role === "admin";
    const allLists = getAccessibleLists(db, user);

    // get subscriber counts per list
    const listCounts = new Map<number, number>();
    for (const list of allLists) {
      const count = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.subscriberLists)
        .where(
          and(
            eq(schema.subscriberLists.listId, list.id),
            eq(schema.subscriberLists.status, "confirmed"),
          ),
        )
        .get()!.count;
      listCounts.set(list.id, count);
    }

    return c.html(
      <AdminLayout title="Lists" user={user} flash={flash}>
        <PageHeader title="Lists">
          {isAdmin && <LinkButton href="/admin/lists/new">New List</LinkButton>}
        </PageHeader>
        <Table>
          <thead>
            <tr>
              <Th>Slug</Th>
              <Th>Name</Th>
              <Th>Domain</Th>
              <Th>Subscribers</Th>
            </tr>
          </thead>
          <tbody>
            {allLists.map((list) => (
              <tr>
                <Td>
                  <a
                    href={`/admin/lists/${list.id}`}
                    class="text-blue-600 hover:text-blue-800"
                  >
                    {list.slug}
                  </a>
                </Td>
                <Td>{list.name}</Td>
                <Td class="text-gray-500">{list.fromDomain}</Td>
                <Td>{listCounts.get(list.id) ?? 0}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </AdminLayout>,
    );
  });

  app.get(
    "/lists/new",
    (c) => {
      const user = c.user as User;
      const flash = getFlash(c);
      return c.html(
        <AdminLayout title="New List" user={user} flash={flash}>
          <PageHeader title="New list" />
          <Card>
            <form method="post" action="/admin/lists/new">
              <div class="grid grid-cols-2 gap-4">
                <FormGroup>
                  <Label for="slug">Slug</Label>
                  <Input
                    type="text"
                    id="slug"
                    name="slug"
                    required
                    placeholder="weekly-digest"
                  />
                </FormGroup>
                <FormGroup>
                  <Label for="name">Name</Label>
                  <Input
                    type="text"
                    id="name"
                    name="name"
                    required
                    placeholder="Weekly Digest"
                  />
                </FormGroup>
              </div>
              <FormGroup>
                <Label for="description">Description</Label>
                <Input
                  type="text"
                  id="description"
                  name="description"
                  placeholder="Optional description"
                />
              </FormGroup>
              <FormGroup>
                <Label for="fromDomain">Sending domain</Label>
                <Input
                  type="text"
                  id="fromDomain"
                  name="fromDomain"
                  required
                  placeholder="siliconharbour.dev"
                  value={config.fromDomain}
                />
              </FormGroup>
              <FormGroup>
                <Label for="fromAddress">Default from address</Label>
                <Input
                  type="email"
                  id="fromAddress"
                  name="fromAddress"
                  placeholder="newsletter@siliconharbour.dev"
                />
              </FormGroup>
              <Button type="submit">Create List</Button>
            </form>
          </Card>
        </AdminLayout>,
      );
    },
    {
      beforeHandle: ({ user, status }) => {
        if (!user || (user.role !== "owner" && user.role !== "admin"))
          return status(403, "Forbidden");
      },
    },
  );

  app.post(
    "/lists/new",
    async (c) => {
      const user = c.user as User;
      const slug = c.body.slug.trim();
      const name = c.body.name.trim();
      const description = c.body.description?.trim() ?? "";
      const fromDomain = c.body.fromDomain?.trim() || config.fromDomain;
      const fromAddress = c.body.fromAddress?.trim() ?? "";

      if (!slug || !name) {
        return c.redirect("/admin/lists/new");
      }

      db.insert(schema.lists)
        .values({ slug, name, description, fromDomain, fromAddress })
        .run();

      logEvent(db, {
        type: "admin.list_created",
        detail: `${name} (${slug})`,
        userId: user.id,
      });

      setFlash(c, "List created.");
      return c.redirect("/admin/lists");
    },
    {
      body: listFormInput,
      beforeHandle: ({ user, status }) => {
        if (!user || (user.role !== "owner" && user.role !== "admin"))
          return status(403, "Forbidden");
      },
    },
  );

  app.get(
    "/lists/:id",
    (c) => {
      const user = c.user as User;
      const flash = getFlash(c);
      const id = c.params.id;
      const list = db
        .select()
        .from(schema.lists)
        .where(eq(schema.lists.id, id))
        .get();
      if (!list) return c.notFound();
      const isAdmin = user.role === "owner" || user.role === "admin";

      const confirmedSubs = db
        .select({
          id: schema.subscribers.id,
          email: schema.subscribers.email,
          firstName: schema.subscribers.firstName,
          lastName: schema.subscribers.lastName,
          subscribedAt: schema.subscriberLists.subscribedAt,
        })
        .from(schema.subscriberLists)
        .innerJoin(
          schema.subscribers,
          eq(schema.subscriberLists.subscriberId, schema.subscribers.id),
        )
        .where(
          and(
            eq(schema.subscriberLists.listId, id),
            eq(schema.subscriberLists.status, "confirmed"),
          ),
        )
        .all();

      const unconfirmedSubs = db
        .select({
          id: schema.subscribers.id,
          email: schema.subscribers.email,
          firstName: schema.subscribers.firstName,
          lastName: schema.subscribers.lastName,
          subscribedAt: schema.subscriberLists.subscribedAt,
        })
        .from(schema.subscriberLists)
        .innerJoin(
          schema.subscribers,
          eq(schema.subscriberLists.subscriberId, schema.subscribers.id),
        )
        .where(
          and(
            eq(schema.subscriberLists.listId, id),
            eq(schema.subscriberLists.status, "unconfirmed"),
          ),
        )
        .all();

      const listCampaigns = db
        .select()
        .from(schema.campaigns)
        .where(
          and(
            eq(schema.campaigns.audienceType, "list"),
            eq(schema.campaigns.audienceId, id),
          ),
        )
        .orderBy(desc(schema.campaigns.createdAt))
        .all();

      return c.html(
        <AdminLayout title={list.name} user={user} flash={flash}>
          <PageHeader title={list.name} />

          <form method="post" action={`/admin/lists/${id}/edit`}>
            <FormGroup>
              <Label for="slug">Slug</Label>
              <Input
                type="text"
                id="slug"
                name="slug"
                required
                value={list.slug}
              />
            </FormGroup>
            <FormGroup>
              <Label for="name">Name</Label>
              <Input
                type="text"
                id="name"
                name="name"
                required
                value={list.name}
              />
            </FormGroup>
            <FormGroup>
              <Label for="description">Description</Label>
              <Input
                type="text"
                id="description"
                name="description"
                value={list.description}
              />
            </FormGroup>
            <FormGroup>
              <Label for="fromDomain">Sending domain</Label>
              <Input
                type="text"
                id="fromDomain"
                name="fromDomain"
                required
                value={list.fromDomain}
              />
            </FormGroup>
            <FormGroup>
              <Label for="fromAddress">Default from address</Label>
              <Input
                type="email"
                id="fromAddress"
                name="fromAddress"
                value={list.fromAddress}
                placeholder={`newsletter@${list.fromDomain}`}
              />
            </FormGroup>
            <Button type="submit">Save changes</Button>
          </form>

          <h2 class="text-xl font-semibold mt-6 mb-3">
            Confirmed subscribers ({confirmedSubs.length})
          </h2>
          {confirmedSubs.length > 0 ? (
            <Table>
              <thead>
                <tr>
                  <Th>Email</Th>
                  <Th>Name</Th>
                  <Th>Subscribed</Th>
                </tr>
              </thead>
              <tbody>
                {confirmedSubs.map((s) => (
                  <tr>
                    <Td>
                      <a
                        href={`/admin/subscribers/${s.id}`}
                        class="text-blue-600 hover:text-blue-800"
                      >
                        {s.email}
                      </a>
                    </Td>
                    <Td>{displayName(s)}</Td>
                    <Td>{fmtDate(s.subscribedAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <p class="text-gray-400">No confirmed subscribers.</p>
          )}

          {unconfirmedSubs.length > 0 && (
            <>
              <h2 class="text-xl font-semibold mt-6 mb-3">
                Pending confirmation ({unconfirmedSubs.length})
              </h2>
              <Table>
                <thead>
                  <tr>
                    <Th>Email</Th>
                    <Th>Name</Th>
                    <Th>Subscribed</Th>
                  </tr>
                </thead>
                <tbody>
                  {unconfirmedSubs.map((s) => (
                    <tr>
                      <Td>
                        <a
                          href={`/admin/subscribers/${s.id}`}
                          class="text-blue-600 hover:text-blue-800"
                        >
                          {s.email}
                        </a>
                      </Td>
                      <Td>{displayName(s)}</Td>
                      <Td>{fmtDate(s.subscribedAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          )}

          {listCampaigns.length > 0 && (
            <>
              <h2 class="text-xl font-semibold mt-6 mb-3">
                Campaigns ({listCampaigns.length})
              </h2>
              <Table>
                <thead>
                  <tr>
                    <Th>Subject</Th>
                    <Th>Status</Th>
                    <Th>Sent</Th>
                  </tr>
                </thead>
                <tbody>
                  {listCampaigns.map((cam) => (
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
                      <Td>{fmtDateTime(cam.sentAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </>
          )}

          {isAdmin && (
            <>
              <hr class="my-8" />
              <form
                method="post"
                action={`/admin/lists/${id}/delete`}
                onsubmit="return confirm('Delete this list? Subscribers will be unlinked but not deleted. Campaigns on this list will also be deleted.')"
              >
                <Button type="submit" variant="danger">
                  Delete List
                </Button>
              </form>
            </>
          )}
        </AdminLayout>,
      );
    },
    {
      params: idInput,
      beforeHandle: ({ user, params, status }) => {
        if (!user || !canAccessList(db, user, params.id))
          return status(403, "Forbidden");
      },
    },
  );

  app.post(
    "/lists/:id/edit",
    async (c) => {
      const user = c.user as User;
      const id = c.params.id;
      const slug = c.body.slug.trim();
      const name = c.body.name.trim();
      const description = c.body.description?.trim() ?? "";
      const fromDomain = c.body.fromDomain?.trim() || config.fromDomain;
      const fromAddress = c.body.fromAddress?.trim() ?? "";

      if (!slug || !name) return c.redirect(`/admin/lists/${id}`);

      db.update(schema.lists)
        .set({ slug, name, description, fromDomain, fromAddress })
        .where(eq(schema.lists.id, id))
        .run();

      logEvent(db, {
        type: "admin.list_edited",
        detail: `${name} (${slug})`,
        userId: user.id,
      });

      setFlash(c, "List saved.");
      return c.redirect(`/admin/lists/${id}`);
    },
    {
      params: idInput,
      body: listFormInput,
      beforeHandle: ({ user, params, status }) => {
        if (!user || !canAccessList(db, user, params.id))
          return status(403, "Forbidden");
      },
    },
  );

  app.post(
    "/lists/:id/delete",
    (c) => {
      const user = c.user as User;
      const id = c.params.id;
      const list = db
        .select()
        .from(schema.lists)
        .where(eq(schema.lists.id, id))
        .get();

      logEvent(db, {
        type: "admin.list_deleted",
        detail: list?.name ?? `id=${id}`,
        userId: user.id,
      });

      // unlink subscriber_lists
      db.delete(schema.subscriberLists)
        .where(eq(schema.subscriberLists.listId, id))
        .run();
      // delete campaigns and their sends
      const campaigns = db
        .select()
        .from(schema.campaigns)
        .where(
          and(
            eq(schema.campaigns.audienceType, "list"),
            eq(schema.campaigns.audienceId, id),
          ),
        )
        .all();
      const campaignIds = campaigns.map((campaign) => campaign.id);
      if (campaignIds.length > 0) {
        db.update(schema.messages)
          .set({ campaignId: null })
          .where(inArray(schema.messages.campaignId, campaignIds))
          .run();
        db.update(schema.events)
          .set({ campaignId: null })
          .where(inArray(schema.events.campaignId, campaignIds))
          .run();
      }
      for (const cam of campaigns) {
        db.delete(schema.campaignSends)
          .where(eq(schema.campaignSends.campaignId, cam.id))
          .run();
      }
      db.delete(schema.campaigns)
        .where(
          and(
            eq(schema.campaigns.audienceType, "list"),
            eq(schema.campaigns.audienceId, id),
          ),
        )
        .run();
      // delete user_lists references
      db.delete(schema.userLists).where(eq(schema.userLists.listId, id)).run();
      // delete list
      db.delete(schema.lists).where(eq(schema.lists.id, id)).run();

      setFlash(c, "List deleted.");
      return c.redirect("/admin/lists");
    },
    {
      params: idInput,
      beforeHandle: ({ user, status }) => {
        if (!user || (user.role !== "owner" && user.role !== "admin"))
          return status(403, "Forbidden");
      },
    },
  );
  return app;
}
