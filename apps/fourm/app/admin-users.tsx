import type { Handle } from "remix/component";
import type { Row } from "./data/community.ts";
import { humanBytes } from "./media-view.tsx";
function created(value: unknown) {
  const text = String(value ?? "");
  return text ? (
    <time
      datetime={text.replace(" ", "T").replace(/(?:\.\d+)?Z?$/, "Z")}
      data-fmt="date"
    >
      {text.slice(0, 10)}
    </time>
  ) : null;
}
export function AdminUserRow(
  handle: Handle<{ user: Row; stats: Row; open?: boolean }>,
) {
  return () => {
    const u = handle.props.user,
      stats = handle.props.stats;
    return (
      <details
        id={`user-row-${u.id}`}
        class="fourm-admin-row"
        open={handle.props.open}
      >
        <summary>
          <strong>@{u.username}</strong>{" "}
          <label title="Only include users who embed the webring widget on a page">
            <input
              type="checkbox"
              name="in_webring"
              value="on"
              checked={Boolean(u.in_webring)}
              hx-post={`/admin/users/${u.id}/toggle-webring`}
              hx-trigger="change"
              hx-target={`#user-row-${u.id}`}
              hx-swap="outerHTML"
            />{" "}
            webring
          </label>{" "}
          <span class="muted">
            · {u.display_name} · {stats.file_count ?? 0} files ·{" "}
            {humanBytes(Number(stats.total_bytes ?? 0))} ·{" "}
            {created(u.created_at)}
            {u.is_admin ? " · admin" : ""}
            {u.is_disabled ? " · disabled" : ""}
          </span>
        </summary>
        <div class="stack fourm-admin-row-body">
          {!u.is_admin ? (
            <div>
              <strong class="fourm-action-label">rename</strong>
              <form
                method="post"
                action={`/admin/users/${u.id}/rename`}
                class="inline fourm-space-xs"
                hx-post={`/admin/users/${u.id}/rename`}
                hx-target={`#user-row-${u.id}`}
                hx-swap="outerHTML"
              >
                <input
                  name="new_username"
                  defaultValue={String(u.username)}
                  class="fourm-field-admin"
                  required
                  placeholder="username"
                />
                <input
                  name="new_display_name"
                  defaultValue={String(u.display_name)}
                  class="fourm-field-admin"
                  placeholder="display name"
                />
                <button type="submit" class="btn-sm">
                  save
                </button>
              </form>
            </div>
          ) : null}
          <div>
            <strong class="fourm-action-label">account</strong>
            <div class="fourm-actions fourm-space-xs">
              <form
                method="post"
                action={`/admin/users/${u.id}/identity`}
                class="inline"
                hx-post={`/admin/users/${u.id}/identity`}
                hx-target={`#user-row-${u.id}`}
                hx-swap="outerHTML"
              >
                <button type="submit" class="btn-sm">
                  manage Jack Auth
                </button>
              </form>
              <form
                method="post"
                action={`/admin/users/${u.id}/toggle-disabled`}
                class="inline"
                hx-post={`/admin/users/${u.id}/toggle-disabled`}
                hx-target={`#user-row-${u.id}`}
                hx-swap="outerHTML"
                hx-confirm={`${u.is_disabled ? "re-enable" : "disable"} ${u.username}?`}
              >
                <button type="submit" class="btn-sm">
                  {u.is_disabled ? "re-enable" : "disable"}
                </button>
              </form>
              {!u.is_admin ? (
                <form
                  method="post"
                  action={`/admin/users/${u.id}/toggle-admin`}
                  class="inline"
                  hx-post={`/admin/users/${u.id}/toggle-admin`}
                  hx-target={`#user-row-${u.id}`}
                  hx-swap="outerHTML"
                  hx-confirm={`make ${u.username} an admin?`}
                >
                  <button type="submit" class="btn-sm">
                    make admin
                  </button>
                </form>
              ) : null}
              <a href={`/u/${u.username}/export`} class="btn-sm">
                export
              </a>
            </div>
          </div>
          {!u.is_admin ? (
            <div>
              <strong class="fourm-action-label fourm-text-danger">
                danger
              </strong>
              <div class="fourm-actions fourm-space-xs">
                <form
                  method="post"
                  action={`/admin/users/${u.id}/delete`}
                  class="inline"
                  hx-post={`/admin/users/${u.id}/delete`}
                  hx-target={`#user-row-${u.id}`}
                  hx-swap="outerHTML"
                  hx-confirm={`delete ${u.username}? their invitees will be reparented.`}
                >
                  <input type="hidden" name="mode" value="reparent" />
                  <button type="submit" class="btn-sm">
                    delete
                  </button>
                </form>
                <form
                  method="post"
                  action={`/admin/users/${u.id}/delete`}
                  class="inline"
                  hx-post={`/admin/users/${u.id}/delete`}
                  hx-target={`#user-row-${u.id}`}
                  hx-swap="outerHTML"
                  hx-confirm={`delete ${u.username} AND everyone they invited? this is irreversible!`}
                >
                  <input type="hidden" name="mode" value="prune" />
                  <button type="submit" class="btn-sm">
                    prune tree
                  </button>
                </form>
              </div>
            </div>
          ) : null}
        </div>
      </details>
    );
  };
}
export function AdminUsers(handle: Handle<{ users: Row[]; storage: Row[] }>) {
  return () => (
    <details class="panel" open>
      <summary>
        <h2>users ({handle.props.users.length})</h2>
      </summary>
      {handle.props.users.map((user) => (
        <AdminUserRow
          user={user}
          stats={handle.props.storage.find((s) => s.id === user.id) ?? {}}
        />
      ))}
    </details>
  );
}
