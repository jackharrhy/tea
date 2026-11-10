/** @jsxRuntime classic */
/** @jsx Html.createElement */
/** @jsxFrag Html.Fragment */
// oxlint-disable-next-line no-unused-vars -- Html is the classic JSX factory.
import { Html } from "@elysia/html";
import type { App } from "../../http";
import { eq, desc, sql } from "drizzle-orm";
import type { Db } from "../../db";
import { schema } from "../../db";
import type { Config } from "../../config";
import { logEvent } from "../../services/events";
import {
  AdminLayout,
  displayName,
  fmtDate,
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

export function mountTagRoutes(app: App, db: Db, _config: Config) {
  app.get("/tags", (c) => {
    const user = c.user as User;
    const flash = getFlash(c);
    const allTags = db
      .select()
      .from(schema.tags)
      .orderBy(desc(schema.tags.createdAt))
      .all();

    const tagCounts = new Map<number, number>();
    for (const tag of allTags) {
      const count = db
        .select({ count: sql<number>`count(*)` })
        .from(schema.subscriberTags)
        .where(eq(schema.subscriberTags.tagId, tag.id))
        .get()!.count;
      tagCounts.set(tag.id, count);
    }

    return c.html(
      <AdminLayout title="Tags" user={user} flash={flash}>
        <PageHeader title="Tags">
          <LinkButton href="/admin/tags/new">New Tag</LinkButton>
        </PageHeader>
        <Table>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Subscribers</Th>
              <Th>Created</Th>
            </tr>
          </thead>
          <tbody>
            {allTags.map((tag) => (
              <tr>
                <Td>
                  <a
                    href={`/admin/tags/${tag.id}`}
                    class="text-blue-600 hover:text-blue-800"
                  >
                    {tag.name}
                  </a>
                </Td>
                <Td>{tagCounts.get(tag.id) ?? 0}</Td>
                <Td>{fmtDate(tag.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </AdminLayout>,
    );
  });

  app.get("/tags/new", (c) => {
    const user = c.user as User;
    const flash = getFlash(c);
    return c.html(
      <AdminLayout title="New Tag" user={user} flash={flash}>
        <PageHeader title="New tag" />
        <Card>
          <form method="post" action="/admin/tags/new">
            <FormGroup>
              <Label for="name">Name</Label>
              <Input type="text" id="name" name="name" required />
            </FormGroup>
            <Button type="submit">Create Tag</Button>
          </form>
        </Card>
      </AdminLayout>,
    );
  });

  app.post("/tags/new", async (c) => {
    const user = c.user as User;
    const body = c.body as Record<string, any>;
    const name = String(body["name"] ?? "").trim();

    if (!name) {
      return c.redirect("/admin/tags/new");
    }

    db.insert(schema.tags).values({ name }).run();

    logEvent(db, { type: "admin.tag_created", detail: name, userId: user.id });

    setFlash(c, "Tag created.");
    return c.redirect("/admin/tags");
  });

  app.get("/tags/:id", (c) => {
    const user = c.user as User;
    const flash = getFlash(c);
    const id = Number(c.params.id);
    const tag = db
      .select()
      .from(schema.tags)
      .where(eq(schema.tags.id, id))
      .get();
    if (!tag) return c.notFound();

    const subscriberCount = db
      .select({ count: sql<number>`count(*)` })
      .from(schema.subscriberTags)
      .where(eq(schema.subscriberTags.tagId, id))
      .get()!.count;

    const taggedSubscribers = db
      .select({
        id: schema.subscribers.id,
        email: schema.subscribers.email,
        firstName: schema.subscribers.firstName,
        lastName: schema.subscribers.lastName,
        status: schema.subscribers.status,
      })
      .from(schema.subscriberTags)
      .innerJoin(
        schema.subscribers,
        eq(schema.subscriberTags.subscriberId, schema.subscribers.id),
      )
      .where(eq(schema.subscriberTags.tagId, id))
      .all();

    return c.html(
      <AdminLayout title={tag.name} user={user} flash={flash}>
        <PageHeader title={tag.name} />
        <dl class="mb-6">
          <dt class="font-semibold text-xs uppercase text-gray-500">Created</dt>
          <dd class="mt-1 ml-0">{fmtDate(tag.createdAt)}</dd>
          <dt class="font-semibold text-xs uppercase text-gray-500 mt-3">
            Subscribers
          </dt>
          <dd class="mt-1 ml-0">{subscriberCount}</dd>
        </dl>

        {taggedSubscribers.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>Email</Th>
                <Th>Name</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {taggedSubscribers.map((s) => (
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
                  <Td>{s.status}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        <hr class="my-8" />
        <form
          method="post"
          action={`/admin/tags/${id}/delete`}
          onsubmit="return confirm('Delete this tag? It will be removed from all subscribers.')"
        >
          <Button type="submit" variant="danger">
            Delete Tag
          </Button>
        </form>
      </AdminLayout>,
    );
  });

  app.post("/tags/:id/delete", (c) => {
    const user = c.user as User;
    const id = Number(c.params.id);
    const tag = db
      .select()
      .from(schema.tags)
      .where(eq(schema.tags.id, id))
      .get();

    logEvent(db, {
      type: "admin.tag_deleted",
      detail: tag?.name ?? `id=${id}`,
      userId: user.id,
    });

    // delete all subscriber_tags for this tag
    db.delete(schema.subscriberTags)
      .where(eq(schema.subscriberTags.tagId, id))
      .run();
    // delete the tag
    db.delete(schema.tags).where(eq(schema.tags.id, id)).run();

    setFlash(c, "Tag deleted.");
    return c.redirect("/admin/tags");
  });
}
