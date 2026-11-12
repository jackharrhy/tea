import { unsafeHTML } from "remix/component";
import type { Handle, RemixNode } from "remix/component";
import type { Member, Row } from "./data/community.ts";
import { postContent } from "./rendering.ts";
import { LocalTime } from "./time.tsx";

// Keep the source banner element intact: saved banner CSS can target its children.
const bannerAttributes: Record<string, string> = { role: "status" };

export function Document(
  handle: Handle<{
    title: string;
    member: Member | null;
    banner?: Row | null;
    html?: string;
    children?: RemixNode;
  }>,
) {
  return () => (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{handle.props.title}</title>
        <link
          rel="icon"
          href={
            "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📒</text></svg>"
          }
        />
        <link rel="stylesheet" href="/static/style.css" />
        <link rel="manifest" href="/static/manifest.json" />
        <meta name="theme-color" content="#00ccff" />
        <script src="/static/htmx.min.js" />
      </head>
      <body
        class="fourm-shell"
        data-vapid-key=""
        data-logged-in={handle.props.member ? "true" : "false"}
      >
        <header class="topbar">
          <a href="/" class="logo">
            4orm
          </a>
          <nav aria-label="Main">
            <a href="/forum">forum</a>
            <a href="/chat">chat</a>
            {handle.props.member ? (
              <>
                <a href={`/u/${handle.props.member.username}`}>my page</a>
                <a href="/settings">settings</a>
                {handle.props.member.is_admin ? (
                  <a href="/admin">admin</a>
                ) : null}
                <form method="post" action="/logout" class="inline">
                  <button>logout</button>
                </form>
              </>
            ) : (
              <>
                <a href="/login">login</a>
                <a href="/register">register</a>
              </>
            )}
          </nav>
        </header>
        {handle.props.banner?.banner_enabled ? (
          <>
            <style
              innerHTML={unsafeHTML(
                String(handle.props.banner.banner_css ?? ""),
              )}
            />
            <aside
              class="site-banner"
              {...bannerAttributes}
              innerHTML={unsafeHTML(
                String(handle.props.banner.banner_html ?? ""),
              )}
            />
          </>
        ) : null}
        <main
          class="wrap"
          innerHTML={
            handle.props.html === undefined
              ? undefined
              : unsafeHTML(handle.props.html)
          }
        >
          {handle.props.children}
        </main>
        <script src="/static/app.js" />
      </body>
    </html>
  );
}
export function Format(handle: Handle<{ value?: string; bbcode?: boolean }>) {
  return () => (
    <>
      <label htmlFor="content-format">Format</label>
      <select id="content-format" name="content_format">
        <option
          value="html"
          selected={(handle.props.value ?? "html") === "html"}
        >
          HTML
        </option>
        <option
          value="markdown"
          selected={(handle.props.value ?? "html") === "markdown"}
        >
          Markdown
        </option>
        {handle.props.bbcode ? (
          <option
            value="bbcode"
            selected={(handle.props.value ?? "html") === "bbcode"}
          >
            BBCode
          </option>
        ) : null}
      </select>
    </>
  );
}
export function Forum(
  handle: Handle<{
    threads: Row[];
    member: Member | null;
    page: number;
    total_pages: number;
  }>,
) {
  return () => (
    <>
      <h1>forum</h1>
      {handle.props.member ? (
        <p>
          <a href="/forum/new">
            <button type="button">new thread</button>
          </a>
        </p>
      ) : null}
      {handle.props.threads.length ? (
        <div class="table-wrap">
          <table class="forum-table">
            <thead>
              <tr>
                <th></th>
                <th>thread</th>
                <th>author</th>
                <th>replies</th>
                <th>last reply</th>
              </tr>
            </thead>
            <tbody>
              {handle.props.threads.map((thread) => (
                <tr>
                  <td>
                    {thread.is_pinned ? "📌" : ""}
                    {thread.is_locked ? "🔒" : ""}
                  </td>
                  <td>
                    <a href={`/forum/${thread.id}`}>{thread.title}</a>
                  </td>
                  <td>
                    <a href={`/u/${thread.author_username}`}>
                      {thread.author_display_name || thread.author_username}
                    </a>
                  </td>
                  <td>{thread.reply_count}</td>
                  <td class="muted">
                    <LocalTime value={thread.last_reply_at} format="relative" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p class="muted">no threads yet. be the first!</p>
      )}
      {handle.props.total_pages > 1 ? (
        <nav class="pagination">
          {Array.from(
            { length: handle.props.total_pages },
            (_, index) => index + 1,
          ).map((page) =>
            page === handle.props.page ? (
              <strong>{page}</strong>
            ) : (
              <a href={`/forum?page=${page}`}>{page}</a>
            ),
          )}
        </nav>
      ) : null}
    </>
  );
}
export function NewThread() {
  return () => (
    <>
      <h1>New thread</h1>
      <form method="post" action="/forum">
        <label>
          Title
          <input name="title" required maxLength={200} />
        </label>
        <label>
          Post
          <textarea name="content" required />
        </label>
        <Format bbcode value="bbcode" />
        <button>Create thread</button>
      </form>
    </>
  );
}
export function Thread(
  handle: Handle<{ thread: Row; posts: Row[]; member: Member | null }>,
) {
  return () => (
    <>
      <h1>{handle.props.thread.title}</h1>
      {handle.props.thread.is_locked ? <p>This thread is locked.</p> : null}
      {handle.props.posts.map((post) => (
        <article id={`post-${post.id}`}>
          <p>
            <a href={`/u/${post.username}`}>{post.display_name}</a>{" "}
            <small>
              {post.created_at}
              {post.is_edited ? " · edited" : ""}
            </small>
          </p>
          <div
            innerHTML={unsafeHTML(
              postContent(String(post.content), String(post.content_format)),
            )}
          />
          {handle.props.member &&
          (handle.props.member.id === post.author_id ||
            handle.props.member.is_admin) ? (
            <p>
              <a href={`/forum/posts/${post.id}/edit`}>Edit post</a>
            </p>
          ) : null}
          {post.forum_signature ? (
            <small
              innerHTML={unsafeHTML(
                postContent(String(post.forum_signature), "bbcode"),
              )}
            />
          ) : null}
        </article>
      ))}
      {handle.props.member &&
      (!handle.props.thread.is_locked || handle.props.member.is_admin) ? (
        <form method="post" action={`/forum/${handle.props.thread.id}/reply`}>
          <label>
            Reply
            <textarea name="content" required />
          </label>
          <Format bbcode value="bbcode" />
          <button>Post reply</button>
        </form>
      ) : null}
      {handle.props.member?.is_admin ? (
        <div class="row">
          {["lock", "pin", "delete"].map((action) => (
            <form
              method="post"
              action={`/forum/${handle.props.thread.id}/moderate`}
            >
              <input type="hidden" name="action" value={action} />
              <button>{action}</button>
            </form>
          ))}
        </div>
      ) : null}
    </>
  );
}
export function Chat(handle: Handle<{ messages: Row[] }>) {
  return () => (
    <>
      <h1>Chat</h1>
      <div
        role="log"
        aria-label="Messages"
        data-chat-log=""
        data-cursor={String(handle.props.messages.at(-1)?.id ?? 0)}
      >
        {handle.props.messages.map((message) => (
          <p>
            <a href={`/u/${message.username}`}>{message.display_name}</a>:{" "}
            {message.message}
          </p>
        ))}
      </div>
      <p role="status" data-chat-status="">
        Connecting…
      </p>
      <p data-chat-presence="">Checking who's here…</p>
      <form method="post" action="/chat" data-chat-form="">
        <label>
          Message
          <input name="message" required maxLength={500} />
        </label>
        <button>Send</button>
      </form>
      <a href="/chat">Refresh messages</a>
      <script type="module" src="/assets/community.js" />
    </>
  );
}
export function BareDocument(
  handle: Handle<{ title: string; children?: RemixNode }>,
) {
  return () => (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{handle.props.title} · 4orm</title>
        <link rel="stylesheet" href="/static/style.css" />
      </head>
      <body>{handle.props.children}</body>
    </html>
  );
}
