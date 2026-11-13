import type { Handle } from "remix/component";
import type { Row } from "./data/community.ts";
function time(value: unknown) {
  const text = String(value ?? "");
  return text ? (
    <time
      datetime={text.replace(" ", "T").replace(/(?:\.\d+)?Z?$/, "Z")}
      data-fmt="full"
    >
      {text.slice(0, 16).replace("T", " ")}
    </time>
  ) : null;
}
export function AdminForum(handle: Handle<{ threads: Row[]; posts: Row[] }>) {
  return () => (
    <>
      <details class="panel">
        <summary>
          <h2>forum threads ({handle.props.threads.length})</h2>
        </summary>
        {handle.props.threads.length ? (
          handle.props.threads.map((t) => (
            <div class="panel fourm-panel-compact">
              <div class="fourm-actions">
                <strong>{t.title}</strong>{" "}
                <span class="muted">
                  by @{t.author_username} · {t.reply_count} replies
                </span>{" "}
                {t.is_pinned ? "📌 " : ""}
                {t.is_locked ? "🔒 " : ""}
                <a href={`/forum/${t.id}/edit`} class="btn-sm">
                  edit
                </a>
                <form
                  method="post"
                  action={`/forum/${t.id}/delete`}
                  class="inline"
                  hx-post={`/forum/${t.id}/delete`}
                  hx-confirm="Delete this thread and all its posts?"
                >
                  <button class="btn-sm">delete</button>
                </form>
                <form
                  method="post"
                  action={`/forum/${t.id}/pin`}
                  class="inline"
                  hx-post={`/forum/${t.id}/pin`}
                >
                  <button class="btn-sm">
                    {t.is_pinned ? "unpin" : "pin"}
                  </button>
                </form>
                <form
                  method="post"
                  action={`/forum/${t.id}/lock`}
                  class="inline"
                  hx-post={`/forum/${t.id}/lock`}
                >
                  <button class="btn-sm">
                    {t.is_locked ? "unlock" : "lock"}
                  </button>
                </form>
              </div>
            </div>
          ))
        ) : (
          <p>no threads.</p>
        )}
      </details>
      <details class="panel">
        <summary>
          <h2>recent forum posts ({handle.props.posts.length})</h2>
        </summary>
        {handle.props.posts.length ? (
          handle.props.posts.map((p) => (
            <div class="panel fourm-panel-compact">
              <div class="forum-post-meta">
                <strong>@{p.author_username}</strong> in{" "}
                <a href={`/forum/${p.thread_id}#post-${p.id}`}>
                  {p.thread_title}
                </a>{" "}
                · {time(p.created_at)}
                {p.is_edited ? (
                  <>
                    {" "}
                    · <em>(edited)</em>
                  </>
                ) : null}
              </div>
              <p class="muted fourm-space-xs">
                {Array.from(String(p.content)).slice(0, 200).join("")}
                {Array.from(String(p.content)).length > 200 ? "..." : ""}
              </p>
              <div class="fourm-actions">
                <a href={`/forum/posts/${p.id}/edit`} class="btn-sm">
                  edit
                </a>
                <form
                  method="post"
                  action={`/forum/posts/${p.id}/delete`}
                  class="inline"
                  hx-post={`/forum/posts/${p.id}/delete`}
                  hx-target="closest .panel"
                  hx-swap="outerHTML"
                  hx-confirm="Delete this post?"
                >
                  <button class="btn-sm">delete</button>
                </form>
              </div>
            </div>
          ))
        ) : (
          <p>no posts.</p>
        )}
      </details>
      <details class="panel">
        <summary>
          <h2>full site export</h2>
        </summary>
        <p class="muted">
          download a complete snapshot of the entire 4orm site: all users,
          pages, media, and forum threads.
        </p>
        <p>
          <a href="/admin/export" class="btn-sm">
            download 4orm-export.zip
          </a>
        </p>
      </details>
    </>
  );
}
