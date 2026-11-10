import { desc, eq, sql } from "drizzle-orm";
import { css, type Handle } from "remix/component";
import { createController } from "remix/router";

import { schema, type Db } from "../src/db/index.ts";
import { logEvent } from "../src/services/events.ts";
import { AdminDocument, type Viewer } from "./admin.tsx";
import { routes } from "./routes.ts";

type User = Pick<
  typeof schema.users.$inferSelect,
  "id" | "role" | "name" | "email"
>;
type Tag = typeof schema.tags.$inferSelect;
type Subscriber = Pick<
  typeof schema.subscribers.$inferSelect,
  "id" | "email" | "firstName" | "lastName" | "status"
>;

const header = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: "20px",
});
const title = css({ fontSize: "24px", fontWeight: 650, margin: 0 });
const button = css({
  display: "inline-block",
  padding: "8px 14px",
  border: "1px solid #1f2937",
  borderRadius: "6px",
  backgroundColor: "#1f2937",
  color: "#fff",
  textDecoration: "none",
  font: "inherit",
  fontSize: "14px",
  cursor: "pointer",
});
const danger = css({
  display: "inline-block",
  padding: "8px 14px",
  border: "1px solid #b91c1c",
  borderRadius: "6px",
  backgroundColor: "#b91c1c",
  color: "#fff",
  font: "inherit",
  fontSize: "14px",
  cursor: "pointer",
});
const table = css({
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "14px",
});
const cell = css({
  padding: "12px 8px",
  borderBottom: "1px solid #e5e7eb",
  textAlign: "left",
});
const link = css({ color: "#1d4ed8", textDecoration: "none" });
const field = css({
  display: "grid",
  gap: "6px",
  marginBottom: "16px",
  maxWidth: "480px",
});
const input = css({
  padding: "9px 12px",
  border: "1px solid #d1d5db",
  borderRadius: "6px",
  font: "inherit",
});
const muted = css({ color: "#6b7280" });
const notice = css({
  marginBottom: "20px",
  padding: "12px 16px",
  backgroundColor: "#ecfdf5",
  color: "#065f46",
});

function TagIndex(
  handle: Handle<{
    viewer: Viewer;
    tags: Array<Tag & { subscriberCount: number }>;
    message: string | null;
  }>,
) {
  return () => (
    <AdminDocument
      title="Tags"
      activeHref="/admin/tags"
      viewer={handle.props.viewer}
    >
      {handle.props.message ? (
        <p mix={notice} role="status">
          {handle.props.message}
        </p>
      ) : null}
      <div mix={header}>
        <h1 mix={title}>Tags</h1>
        <a mix={button} href="/admin/tags/new">
          New tag
        </a>
      </div>
      <table mix={table}>
        <thead>
          <tr>
            <th mix={cell}>Name</th>
            <th mix={cell}>Subscribers</th>
            <th mix={cell}>Created</th>
          </tr>
        </thead>
        <tbody>
          {handle.props.tags.map((tag) => (
            <tr>
              <td mix={cell}>
                <a mix={link} href={`/admin/tags/${tag.id}`}>
                  {tag.name}
                </a>
              </td>
              <td mix={cell}>{tag.subscriberCount}</td>
              <td mix={cell}>{new Date(tag.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {handle.props.tags.length === 0 ? <p mix={muted}>No tags yet.</p> : null}
    </AdminDocument>
  );
}

function NewTag(handle: Handle<{ viewer: Viewer }>) {
  return () => (
    <AdminDocument
      title="New tag"
      activeHref="/admin/tags"
      viewer={handle.props.viewer}
    >
      <h1 mix={title}>New tag</h1>
      <form method="post" action="/admin/tags/new">
        <label mix={field}>
          Name
          <input mix={input} name="name" required />
        </label>
        <button mix={button} type="submit">
          Create tag
        </button>
      </form>
    </AdminDocument>
  );
}

function TagDetail(
  handle: Handle<{ viewer: Viewer; tag: Tag; subscribers: Subscriber[] }>,
) {
  return () => (
    <AdminDocument
      title={handle.props.tag.name}
      activeHref="/admin/tags"
      viewer={handle.props.viewer}
    >
      <h1 mix={title}>{handle.props.tag.name}</h1>
      <p mix={muted}>
        Created {new Date(handle.props.tag.createdAt).toLocaleDateString()} ·{" "}
        {handle.props.subscribers.length} subscribers
      </p>
      {handle.props.subscribers.length ? (
        <table mix={table}>
          <thead>
            <tr>
              <th mix={cell}>Email</th>
              <th mix={cell}>Name</th>
              <th mix={cell}>Status</th>
            </tr>
          </thead>
          <tbody>
            {handle.props.subscribers.map((subscriber) => (
              <tr>
                <td mix={cell}>
                  <a mix={link} href={`/admin/subscribers/${subscriber.id}`}>
                    {subscriber.email}
                  </a>
                </td>
                <td mix={cell}>
                  {[subscriber.firstName, subscriber.lastName]
                    .filter(Boolean)
                    .join(" ") || "—"}
                </td>
                <td mix={cell}>{subscriber.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p mix={muted}>No subscribers have this tag.</p>
      )}
      <details>
        <summary>Delete tag</summary>
        <form
          method="post"
          action={`/admin/tags/${handle.props.tag.id}/delete`}
        >
          <p>This removes the tag from every subscriber.</p>
          <button mix={danger} type="submit">
            Delete tag
          </button>
        </form>
      </details>
    </AdminDocument>
  );
}

function parseId(value: string) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function redirect(location: string) {
  return new Response(null, { status: 303, headers: { Location: location } });
}

export function createAdminTagsController(db: Db, user: User) {
  const viewer: Viewer = {
    name: user.name ?? user.email,
    isAdmin: user.role !== "member",
  };
  return createController(routes.admin.tags, {
    actions: {
      index(context) {
        const tags = db
          .select()
          .from(schema.tags)
          .orderBy(desc(schema.tags.createdAt))
          .all()
          .map((tag) => ({
            ...tag,
            subscriberCount:
              db
                .select({ count: sql<number>`count(*)` })
                .from(schema.subscriberTags)
                .where(eq(schema.subscriberTags.tagId, tag.id))
                .get()?.count ?? 0,
          }));
        const status = new URL(context.request.url).searchParams.get("status");
        const message =
          status === "created"
            ? "Tag created."
            : status === "deleted"
              ? "Tag deleted."
              : null;
        return context.render(
          <TagIndex viewer={viewer} tags={tags} message={message} />,
        );
      },
      new(context) {
        return context.render(<NewTag viewer={viewer} />);
      },
      async create(context) {
        const name = String(
          (await context.request.formData()).get("name") ?? "",
        ).trim();
        if (!name) return new Response("Tag name is required", { status: 400 });
        db.insert(schema.tags).values({ name }).run();
        logEvent(db, {
          type: "admin.tag_created",
          detail: name,
          userId: user.id,
        });
        return redirect("/admin/tags?status=created");
      },
      show(context) {
        const id = parseId(context.params.id);
        if (!id) return new Response("Bad Request", { status: 400 });
        const tag = db
          .select()
          .from(schema.tags)
          .where(eq(schema.tags.id, id))
          .get();
        if (!tag) return new Response("Not Found", { status: 404 });
        const subscribers = db
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
        return context.render(
          <TagDetail viewer={viewer} tag={tag} subscribers={subscribers} />,
        );
      },
      destroy(context) {
        const id = parseId(context.params.id);
        if (!id) return new Response("Bad Request", { status: 400 });
        const tag = db
          .select()
          .from(schema.tags)
          .where(eq(schema.tags.id, id))
          .get();
        if (!tag) return new Response("Not Found", { status: 404 });
        db.transaction((tx) => {
          tx.delete(schema.subscriberTags)
            .where(eq(schema.subscriberTags.tagId, id))
            .run();
          tx.delete(schema.tags).where(eq(schema.tags.id, id)).run();
        });
        logEvent(db, {
          type: "admin.tag_deleted",
          detail: tag.name,
          userId: user.id,
        });
        return redirect("/admin/tags?status=deleted");
      },
    },
  });
}
