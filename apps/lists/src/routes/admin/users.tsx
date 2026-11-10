/** @jsxRuntime classic */
/** @jsx Html.createElement */
/** @jsxFrag Html.Fragment */
// oxlint-disable-next-line no-unused-vars -- Html is the classic JSX factory.
import { Html } from "@elysia/html";
import type { App } from "../../http";
import { eq, desc } from "drizzle-orm";
import type { Db } from "../../db";
import { schema } from "../../db";
import type { Config } from "../../config";
import { requireRole } from "../../auth";
import { logEvent } from "../../services/events";
import {
  AdminLayout,
  fmtDate,
  fmtDateTime,
  setFlash,
  getFlash,
  type User,
} from "./layout";
import {
  Button,
  LinkButton,
  Input,
  Select,
  Label,
  FormGroup,
  Table,
  Th,
  Td,
  Card,
  PageHeader,
} from "./ui";

export function mountUserRoutes(app: App, db: Db, _config: Config) {
  app.guard({ beforeHandle: requireRole("owner", "admin") }, (group) => {
    group.get("/users/new", (c) => {
      const user = c.user as User;
      const flash = getFlash(c);
      const allLists = db.select().from(schema.lists).all();

      return c.html(
        <AdminLayout title="Invite User" user={user} flash={flash}>
          <PageHeader title="Invite user" />
          <Card>
            <form method="post" action="/admin/users/new">
              <FormGroup>
                <Label for="email">Email</Label>
                <Input type="email" id="email" name="email" required />
              </FormGroup>
              <FormGroup>
                <Label for="name">Name</Label>
                <Input type="text" id="name" name="name" />
              </FormGroup>
              <FormGroup>
                <Label for="password">Password</Label>
                <Input type="password" id="password" name="password" required />
              </FormGroup>
              <FormGroup>
                <Label for="role">Role</Label>
                <Select
                  id="role"
                  name="role"
                  onchange="document.getElementById('listSection').style.display = this.value === 'member' ? 'block' : 'none'"
                >
                  <option value="admin">Admin</option>
                  <option value="member" selected>
                    Member
                  </option>
                </Select>
              </FormGroup>
              <div id="listSection" class="mb-4">
                <p class="text-sm font-medium text-gray-700 mb-2">
                  List access (for members)
                </p>
                {allLists.map((list) => (
                  <label class="flex items-center gap-2 text-sm text-gray-800 mb-1">
                    <input
                      type="checkbox"
                      name="lists"
                      value={String(list.id)}
                    />
                    {list.name}
                  </label>
                ))}
              </div>
              <Button type="submit">Create User</Button>
            </form>
          </Card>
        </AdminLayout>,
      );
    });

    group.post("/users/new", async (c) => {
      const user = c.user as User;
      const body = c.body as Record<string, any>;
      const email = String(body["email"] ?? "")
        .trim()
        .toLowerCase();
      const name = String(body["name"] ?? "").trim() || null;
      const password = String(body["password"] ?? "");
      const rawRole = String(body["role"] ?? "member");
      const allowedRoles =
        user.role === "owner"
          ? ["owner", "admin", "member"]
          : ["admin", "member"];
      const role: "owner" | "admin" | "member" = allowedRoles.includes(rawRole)
        ? (rawRole as "owner" | "admin" | "member")
        : "member";

      if (!email || !password) {
        return c.redirect("/admin/users/new");
      }

      const passwordHash = await Bun.password.hash(password);

      const newUser = db
        .insert(schema.users)
        .values({ email, name, passwordHash, role })
        .returning({ id: schema.users.id })
        .get();

      // Insert user_lists for members
      if (role === "member" && body["lists"]) {
        const listIds = (
          Array.isArray(body["lists"])
            ? (body["lists"] as string[])
            : [body["lists"] as string]
        ).map(Number);
        for (const listId of listIds) {
          db.insert(schema.userLists)
            .values({ userId: newUser.id, listId })
            .run();
        }
      }

      logEvent(db, {
        type: "admin.user_created",
        detail: email,
        userId: user.id,
      });

      setFlash(c, "User invited.");
      return c.redirect("/admin/users");
    });

    group.get("/users/:id", (c) => {
      const currentUser = c.user as User;
      const flash = getFlash(c);
      const id = Number(c.params.id);
      const targetUser = db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, id))
        .get();
      if (!targetUser) return c.notFound();

      const allLists = db.select().from(schema.lists).all();
      const assignedLists = db
        .select()
        .from(schema.userLists)
        .where(eq(schema.userLists.userId, id))
        .all();
      const assignedListIds = new Set(assignedLists.map((ul) => ul.listId));

      return c.html(
        <AdminLayout title={targetUser.email} user={currentUser} flash={flash}>
          <PageHeader title={targetUser.name ?? targetUser.email} />
          <Card>
            <form method="post" action={`/admin/users/${id}/edit`}>
              <FormGroup>
                <Label for="name">Name</Label>
                <Input
                  type="text"
                  id="name"
                  name="name"
                  value={targetUser.name ?? ""}
                />
              </FormGroup>
              <FormGroup>
                <Label for="role">Role</Label>
                <Select
                  id="role"
                  name="role"
                  onchange="document.getElementById('editListSection').style.display = this.value === 'member' ? 'block' : 'none'"
                >
                  <option value="owner" selected={targetUser.role === "owner"}>
                    Owner
                  </option>
                  <option value="admin" selected={targetUser.role === "admin"}>
                    Admin
                  </option>
                  <option
                    value="member"
                    selected={targetUser.role === "member"}
                  >
                    Member
                  </option>
                </Select>
              </FormGroup>
              <div
                id="editListSection"
                class="mb-4"
                style={targetUser.role === "member" ? "" : "display:none"}
              >
                <p class="text-sm font-medium text-gray-700 mb-2">
                  List access (for members)
                </p>
                {allLists.map((list) => (
                  <label class="flex items-center gap-2 text-sm text-gray-800 mb-1">
                    <input
                      type="checkbox"
                      name="lists"
                      value={String(list.id)}
                      checked={assignedListIds.has(list.id)}
                    />
                    {list.name}
                  </label>
                ))}
              </div>
              <FormGroup>
                <Label for="password">
                  New password (leave blank to keep current)
                </Label>
                <Input type="password" id="password" name="password" />
              </FormGroup>
              <Button type="submit">Save changes</Button>
            </form>
          </Card>

          <dl class="mt-4">
            <dt class="font-semibold text-xs uppercase text-gray-500">Email</dt>
            <dd class="mt-1 ml-0">{targetUser.email}</dd>
            <dt class="font-semibold text-xs uppercase text-gray-500 mt-3">
              Created
            </dt>
            <dd class="mt-1 ml-0">{fmtDateTime(targetUser.createdAt)}</dd>
          </dl>

          {currentUser.id !== id && (
            <>
              <hr class="my-8" />
              <form
                method="post"
                action={`/admin/users/${id}/delete`}
                onsubmit="return confirm('Delete this user? This cannot be undone.')"
              >
                <Button type="submit" variant="danger">
                  Delete User
                </Button>
              </form>
            </>
          )}
        </AdminLayout>,
      );
    });

    group.post("/users/:id/edit", async (c) => {
      const currentUser = c.user as User;
      const id = Number(c.params.id);
      const body = c.body as Record<string, any>;
      const name = String(body["name"] ?? "").trim() || null;
      const role = String(body["role"] ?? "member");
      const password = String(body["password"] ?? "").trim();

      const updates: Record<string, any> = { name, role };
      if (password) {
        updates.passwordHash = await Bun.password.hash(password);
      }

      db.update(schema.users).set(updates).where(eq(schema.users.id, id)).run();

      // Sync user_lists: delete all, re-insert selected
      db.delete(schema.userLists).where(eq(schema.userLists.userId, id)).run();
      if (role === "member" && body["lists"]) {
        const listIds = (
          Array.isArray(body["lists"])
            ? (body["lists"] as string[])
            : [body["lists"] as string]
        ).map(Number);
        for (const listId of listIds) {
          db.insert(schema.userLists).values({ userId: id, listId }).run();
        }
      }

      logEvent(db, {
        type: "admin.user_edited",
        detail: `user #${id}`,
        userId: currentUser.id,
      });

      setFlash(c, "User updated.");
      return c.redirect(`/admin/users/${id}`);
    });

    group.post("/users/:id/delete", (c) => {
      const currentUser = c.user as User;
      const id = Number(c.params.id);

      // Can't delete yourself
      if (currentUser.id === id) {
        return c.text("Cannot delete yourself", 400);
      }

      const targetUser = db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, id))
        .get();

      logEvent(db, {
        type: "admin.user_deleted",
        detail: targetUser?.email ?? `id=${id}`,
        userId: currentUser.id,
      });

      // Delete user_lists
      db.delete(schema.userLists).where(eq(schema.userLists.userId, id)).run();
      // Set events.userId to null
      db.update(schema.events)
        .set({ userId: null })
        .where(eq(schema.events.userId, id))
        .run();
      // Delete user
      db.delete(schema.users).where(eq(schema.users.id, id)).run();

      setFlash(c, "User removed.");
      return c.redirect("/admin/users");
    });

    group.get("/users", (c) => {
      const user = c.user as User;
      const flash = getFlash(c);
      const allUsers = db
        .select()
        .from(schema.users)
        .orderBy(desc(schema.users.createdAt))
        .all();

      return c.html(
        <AdminLayout title="Users" user={user} flash={flash}>
          <PageHeader title="Users">
            <LinkButton href="/admin/users/new">Invite User</LinkButton>
          </PageHeader>
          <Table>
            <thead>
              <tr>
                <Th>Email</Th>
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {allUsers.map((u) => (
                <tr>
                  <Td>
                    <a
                      href={`/admin/users/${u.id}`}
                      class="text-blue-600 hover:text-blue-800"
                    >
                      {u.email}
                    </a>
                  </Td>
                  <Td>{u.name ?? "—"}</Td>
                  <Td>{u.role}</Td>
                  <Td>{fmtDate(u.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </AdminLayout>,
      );
    });
    return app;
  });
}
