import { css, unsafeHTML } from "remix/component";
import type { Handle, RemixNode } from "remix/component";
import type { Member, Row } from "./data/community.ts";
import { postContent } from "./rendering.ts";
import { chatMessageHTML } from "./chat-html.ts";
import { MediaPicker } from "./settings-view.tsx";
import { LocalTime } from "./time.tsx";

// Paint the document canvas from SSR, before the external stylesheet arrives.
// Ordinary links/history stay browser-owned (including form/scroll restoration).
const shellCanvas = css({
  backgroundColor: "#f0f0f0",
  color: "#111",
  colorScheme: "light",
});

// Keep the source banner element intact: saved banner CSS can target its children.
const bannerAttributes: Record<string, string> = { role: "status" };

export function Document(
  handle: Handle<{
    title: string;
    vapidKey?: string;
    member: Member | null;
    banner?: Row | null;
    html?: string;
    children?: RemixNode;
  }>,
) {
  return () => (
    <html lang="en" mix={shellCanvas}>
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
        <script defer src="/static/htmx.min.js" />
      </head>
      <body
        class="fourm-shell"
        data-vapid-key={handle.props.vapidKey ?? ""}
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
        <script defer src="/static/app.js" />
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
interface ThreadProps {
  thread: Row;
  posts: Row[];
  member: Member | null;
  page: number;
  total_pages: number;
  watching: boolean;
  media: Row[];
}
export function ThreadHeader(handle: Handle<ThreadProps>) {
  return () => {
    const { thread, member, watching } = handle.props;
    return (
      <>
        {thread.custom_css ? (
          <style innerHTML={unsafeHTML(String(thread.custom_css))} />
        ) : null}
        <h1>{thread.title}</h1>
        <p class="muted">
          by{" "}
          <a href={`/u/${thread.author_username}`}>
            {thread.author_display_name || thread.author_username}
          </a>
          {" · "}
          <LocalTime value={thread.created_at} format="full" />
          {thread.is_pinned ? " · 📌 pinned" : ""}
          {thread.is_locked ? " · 🔒 locked" : ""}
        </p>
        <div class="fourm-actions fourm-space-sm">
          {member && (member.id === thread.author_id || member.is_admin) ? (
            <a href={`/forum/${thread.id}/edit`} class="btn-sm">
              edit thread
            </a>
          ) : null}
          {member && (member.id === thread.author_id || member.is_admin) ? (
            <form
              method="post"
              action={`/forum/${thread.id}/delete`}
              class="fourm-inline-form"
              hx-post={`/forum/${thread.id}/delete`}
              hx-confirm="Delete this thread and all its posts?"
            >
              <button class="btn-sm">delete thread</button>
            </form>
          ) : null}
          {member?.is_admin ? (
            <>
              <form
                method="post"
                action={`/forum/${thread.id}/pin`}
                class="fourm-inline-form"
                hx-post={`/forum/${thread.id}/pin`}
              >
                <button class="btn-sm">
                  {thread.is_pinned ? "unpin" : "pin"}
                </button>
              </form>
              <form
                method="post"
                action={`/forum/${thread.id}/lock`}
                class="fourm-inline-form"
                hx-post={`/forum/${thread.id}/lock`}
              >
                <button class="btn-sm">
                  {thread.is_locked ? "unlock" : "lock"}
                </button>
              </form>
            </>
          ) : null}
          {member ? (
            <form
              method="post"
              action={`/forum/${thread.id}/watch`}
              class="fourm-inline-form"
              hx-post={`/forum/${thread.id}/watch`}
            >
              <button class="btn-sm">
                {watching ? "👁 unwatch" : "👁 watch"}
              </button>
            </form>
          ) : null}
        </div>
      </>
    );
  };
}
export function Thread(handle: Handle<ThreadProps>) {
  return () => {
    const { thread, posts, member, page, total_pages } = handle.props;
    return (
      <>
        <div id="forum-posts">
          {posts.map((post) => (
            <div class="forum-post" id={`post-${post.id}`}>
              <div class="forum-post-meta">
                <a href={`/u/${post.author_username}`}>
                  <strong>
                    {post.author_display_name || post.author_username}
                  </strong>
                </a>
                {" · "}
                <LocalTime value={post.created_at} format="full" />
                {post.is_edited ? (
                  <>
                    {" "}
                    · <em>(edited)</em>
                  </>
                ) : null}
                {member && !thread.is_locked ? (
                  <button
                    type="button"
                    class="btn-sm"
                    data-post-id={String(post.id)}
                    data-author={String(post.author_username)}
                    data-content={String(post.content)}
                  >
                    quote
                  </button>
                ) : null}
                {member && (member.id === post.author_id || member.is_admin) ? (
                  <>
                    <a href={`/forum/posts/${post.id}/edit`}>
                      <button type="button" class="btn-sm">
                        edit
                      </button>
                    </a>
                    <form
                      method="post"
                      action={`/forum/posts/${post.id}/delete`}
                      class="fourm-inline-form"
                      hx-post={`/forum/posts/${post.id}/delete`}
                      hx-target={`#post-${post.id}`}
                      hx-swap="outerHTML"
                      hx-confirm="Delete this post?"
                    >
                      <button class="btn-sm">delete</button>
                    </form>
                  </>
                ) : null}
              </div>{" "}
              {post.quoted_content ? (
                <blockquote class="forum-quote" id={`quote-${post.id}`}>
                  {post.quoted_author ? (
                    <>
                      <strong>
                        <a href={`#post-${post.quoted_post_id}`}>
                          {post.quoted_author} wrote:
                        </a>
                      </strong>
                      <br />{" "}
                    </>
                  ) : null}
                  <div
                    class={
                      "forum-quote-body" +
                      (String(post.quoted_content).length > 300
                        ? " forum-quote-collapsed"
                        : "")
                    }
                    innerHTML={unsafeHTML(
                      postContent(
                        String(post.quoted_content),
                        String(post.quoted_content_format || "bbcode"),
                      ),
                    )}
                  />
                  {String(post.quoted_content).length > 300 ? (
                    <button type="button" class="btn-sm forum-quote-toggle">
                      show more
                    </button>
                  ) : null}
                </blockquote>
              ) : null}{" "}
              <div
                class="forum-post-content"
                innerHTML={unsafeHTML(
                  postContent(
                    String(post.content),
                    String(post.content_format),
                  ),
                )}
              />
              {post.author_signature ? (
                <div
                  class="forum-signature"
                  innerHTML={unsafeHTML(
                    postContent(String(post.author_signature), "bbcode"),
                  )}
                />
              ) : null}
            </div>
          ))}
        </div>
        {total_pages > 1 ? (
          <nav class="pagination">
            {Array.from({ length: total_pages }, (_, i) => i + 1).map((n) =>
              n === page ? (
                <strong>{n}</strong>
              ) : (
                <a href={`/forum/${thread.id}?page=${n}`}>{n}</a>
              ),
            )}
          </nav>
        ) : null}
        {!member ? (
          <p class="muted fourm-space-md">
            <a href="/login">log in</a> to reply
          </p>
        ) : thread.is_locked ? (
          <p class="muted fourm-space-md">🔒 this thread is locked</p>
        ) : (
          <details class="panel fourm-space-lg" id="reply-details">
            <summary>
              <h2>reply</h2>
            </summary>
            <form
              method="post"
              action={`/forum/${thread.id}/reply`}
              hx-post={`/forum/${thread.id}/reply`}
              class="stack"
            >
              <input
                type="hidden"
                name="quoted_post_id"
                id="quoted_post_id"
                value=""
              />
              <input
                type="hidden"
                name="quoted_content"
                id="quoted_content"
                value=""
              />
              <input
                type="hidden"
                name="quoted_author"
                id="quoted_author"
                value=""
              />
              <div id="quote-preview" class="forum-quote fourm-hidden">
                <div class="fourm-actions fourm-actions-spaced">
                  <strong>
                    quoting <span id="quote-preview-author"></span>:
                  </strong>
                  <button type="button" class="btn-sm">
                    remove
                  </button>
                </div>
                <p id="quote-preview-text" class="muted fourm-space-xs"></p>
              </div>
              <label>
                format (
                <a
                  href="https://www.phpbb.com/community/help/bbcode"
                  target="_blank"
                >
                  BBCode?
                </a>
                ):
                <select name="content_format">
                  <option value="bbcode" selected>
                    BBCode
                  </option>
                  <option value="markdown">Markdown</option>
                </select>
              </label>
              <textarea
                name="content"
                id="reply-content"
                rows={6}
                required
                placeholder="write your reply..."
              ></textarea>
              <MediaPicker
                items={handle.props.media}
                editor="reply-content"
                format="bbcode"
              />
              <div class="fourm-actions fourm-space-xs">
                <button type="submit">post reply</button>
                <button
                  type="button"
                  class="btn-sm"
                  data-preview-editor="reply-content"
                >
                  preview
                </button>
              </div>
              <div
                id="preview-reply-content"
                class="forum-preview fourm-hidden"
                data-state="idle"
              ></div>
            </form>
          </details>
        )}
      </>
    );
  };
}
export function Chat(
  handle: Handle<{ messages: Row[]; member: Member | null }>,
) {
  return () => (
    <>
      <div class="chat-room" hx-ext="sse" sse-connect="/chat/stream">
        <div id="chat-presence" sse-swap="presence" hx-swap="innerHTML"></div>
        <div
          id="chat-messages"
          sse-swap="message"
          hx-swap="beforeend scroll:bottom"
          innerHTML={unsafeHTML(
            handle.props.messages
              .map((message, index) =>
                chatMessageHTML(message, index, handle.props.messages.length),
              )
              .join("\n"),
          )}
        />
        {handle.props.member ? (
          <form
            class="chat-input"
            method="post"
            action="/chat"
            hx-post="/chat"
            hx-swap="none"
          >
            <input
              type="text"
              name="message"
              maxLength={500}
              placeholder="say something..."
              required
              autoComplete="off"
            />
            <button type="submit">send</button>
          </form>
        ) : (
          <p class="muted fourm-chat-empty">
            <a href="/login">sign in</a> to chat
          </p>
        )}
      </div>
      <script defer src="/static/htmx-sse.js" />
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
