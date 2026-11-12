import { css, unsafeHTML } from "remix/component";
import type { Handle, RemixNode } from "remix/component";
import type { Member, Row } from "./data/community.ts";
import { content, postContent } from "./rendering.ts";

const styles = css({
  fontFamily: "Arial, sans-serif",
  color: "#111",
  backgroundColor: "#efefef",
  lineHeight: 1.5,
  "& *": { boxSizing: "border-box" },
  "& body": { margin: 0 },
  "& header": {
    backgroundColor: "#00c4e8",
    borderBottom: "3px solid #00859c",
    padding: "12px 20px",
    display: "flex",
    gap: "24px",
    alignItems: "center",
    flexWrap: "wrap",
  },
  "& nav": {
    display: "flex",
    gap: "16px",
    alignItems: "center",
    flexWrap: "wrap",
  },
  "& main": { maxWidth: "1000px", padding: "20px", margin: "0 auto" },
  "& h1": { fontSize: "2rem", lineHeight: 1.2 },
  "& a": { color: "#002d9c", textUnderlineOffset: "3px" },
  "& a:focus-visible,& button:focus-visible,& input:focus-visible,& textarea:focus-visible,& select:focus-visible":
    { outline: "3px solid #006381", outlineOffset: "3px" },
  "& form": {
    display: "grid",
    gap: "12px",
    maxWidth: "760px",
    marginBlock: "16px",
  },
  "& header form": { display: "block", margin: 0 },
  "& label": { display: "grid", gap: "4px" },
  "& input,& textarea,& select,& button": {
    font: "inherit",
    padding: "8px",
    maxWidth: "100%",
    minWidth: 0,
  },
  "& textarea": { minHeight: "160px", width: "100%" },
  "& button": {
    width: "fit-content",
    cursor: "pointer",
    backgroundColor: "white",
    border: "2px outset #aaa",
  },
  "& article": {
    paddingBlock: "16px",
    borderBottom: "1px solid #aaa",
    overflowWrap: "anywhere",
  },
  "& table": { width: "100%", borderCollapse: "collapse" },
  "& td,& th": {
    textAlign: "left",
    padding: "10px 6px",
    borderBottom: "1px solid #bbb",
  },
  "& pre": {
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    font: "inherit",
  },
  "& img,& video,& audio": { maxWidth: "100%" },
  "& small": { color: "#444" },
  "& .row": {
    display: "flex",
    gap: "12px",
    alignItems: "center",
    flexWrap: "wrap",
  },
  "& .row form": { display: "inline-block", margin: 0 },
  "@media(max-width:600px)": {
    "& main": { padding: "12px" },
    "& header": { padding: "10px 12px", gap: "10px" },
    "& h1": { fontSize: "1.65rem" },
  },
});

export function Document(
  handle: Handle<{
    title: string;
    member: Member | null;
    children?: RemixNode;
  }>,
) {
  return () => (
    <html lang="en" mix={styles}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{handle.props.title} · 4orm</title>
      </head>
      <body>
        <header>
          <a href="/">
            <strong>4orm</strong>
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
                <form method="post" action="/logout">
                  <button>logout</button>
                </form>
              </>
            ) : (
              <a href="/auth/start">sign in</a>
            )}
          </nav>
        </header>
        <main>{handle.props.children}</main>
      </body>
    </html>
  );
}
export function Members(handle: Handle<{ members: Row[] }>) {
  return () => (
    <>
      <h1>Welcome to 4orm</h1>
      <p>A place for our pages, conversations, and whatever we're making.</p>
      <h2>Members</h2>
      <ul>
        {handle.props.members.map((member) => (
          <li>
            <a href={`/u/${member.username}`}>{member.display_name}</a>{" "}
            <small>@{member.username}</small>
            {member.status_text ? (
              <>
                {" "}
                · {member.status_emoji} {member.status_text}
              </>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
export function Profile(handle: Handle<{ profile: Row; pages: Row[] }>) {
  return () => (
    <>
      <h1>{handle.props.profile.display_name}</h1>
      {handle.props.profile.avatar_path ? (
        <img
          src={`/uploads/${handle.props.profile.avatar_path}`}
          alt={`${handle.props.profile.display_name}'s avatar`}
          width={96}
          height={96}
        />
      ) : null}
      <p>
        @{handle.props.profile.username} · {handle.props.profile.status_emoji}{" "}
        {handle.props.profile.status_text}
      </p>
      <article
        innerHTML={unsafeHTML(
          content(
            String(handle.props.profile.content ?? ""),
            String(handle.props.profile.content_format),
          ),
        )}
      />
      <style
        innerHTML={unsafeHTML(String(handle.props.profile.custom_css ?? ""))}
      />
      <div
        innerHTML={unsafeHTML(String(handle.props.profile.custom_html ?? ""))}
      />
      <h2>Pages</h2>
      <p>
        <a href={`/u/${handle.props.profile.username}/guestbook`}>Guestbook</a>{" "}
        · <a href={`/u/${handle.props.profile.username}/player`}>Playlist</a> ·{" "}
        <a href={`/u/${handle.props.profile.username}/webring`}>Webring</a> ·{" "}
        <a href="/lineage">Invite tree</a>
      </p>
      <ul>
        {handle.props.pages.map((page) => (
          <li>
            <a href={`/u/${handle.props.profile.username}/page/${page.slug}`}>
              {page.title}
            </a>
            {page.is_public ? null : " (private)"}
          </li>
        ))}
      </ul>
    </>
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
export function Settings(
  handle: Handle<{ member: Member; profile: Row; pages: Row[] }>,
) {
  return () => (
    <>
      <h1>Settings</h1>
      <p>
        Signed in as {handle.props.member.display_name}. Your identity is linked
        through Jack Auth.
      </p>
      <form method="post" action="/settings">
        <label>
          Display name
          <input
            name="display_name"
            required
            maxLength={80}
            value={String(handle.props.profile.display_name)}
          />
        </label>
        <label htmlFor="content">Page content</label>
        <textarea
          id="content"
          name="content"
          defaultValue={String(handle.props.profile.content ?? "")}
        />
        <Format value={String(handle.props.profile.content_format ?? "html")} />
        <label htmlFor="custom_css">Custom CSS</label>
        <textarea
          id="custom_css"
          name="custom_css"
          defaultValue={String(handle.props.profile.custom_css ?? "")}
        />
        <label htmlFor="custom_html">Custom HTML</label>
        <textarea
          id="custom_html"
          name="custom_html"
          defaultValue={String(handle.props.profile.custom_html ?? "")}
        />
        <label>
          Forum signature
          <input
            name="forum_signature"
            value={String(handle.props.profile.forum_signature ?? "")}
          />
        </label>
        <button>Save profile</button>
      </form>
      <h2>Your pages</h2>
      <ul>
        {handle.props.pages.map((page) => (
          <li class="row">
            <a href={`/u/${handle.props.member.username}/page/${page.slug}`}>
              {page.title}
            </a>
            <a href={`/settings/pages/${page.slug}`}>edit</a>
            <form method="post" action={`/settings/pages/${page.slug}/delete`}>
              <button>Delete {page.title}</button>
            </form>
          </li>
        ))}
      </ul>
      <p>
        <a href="/settings/pages/new">Create a page</a> ·{" "}
        <a href="/settings/media">Media library</a> ·{" "}
        <a href="/settings/invites">Invites</a> ·{" "}
        <a href="/settings/widgets">Widgets and profile card</a>
      </p>
    </>
  );
}
export function PageEditor(handle: Handle<{ page?: Row }>) {
  return () => (
    <>
      <h1>{handle.props.page ? "Edit page" : "Create a page"}</h1>
      <form method="post">
        <label>
          Slug
          <input
            name="slug"
            required
            pattern="[^/]{1,80}"
            maxLength={80}
            value={String(handle.props.page?.slug ?? "")}
          />
        </label>
        <label>
          Title
          <input
            name="title"
            required
            maxLength={140}
            value={String(handle.props.page?.title ?? "")}
          />
        </label>
        <label htmlFor="content">Content</label>
        <textarea
          id="content"
          name="content"
          defaultValue={String(handle.props.page?.content ?? "")}
        />
        <Format value={String(handle.props.page?.content_format ?? "html")} />
        <label>
          <span>
            <input
              type="checkbox"
              name="is_public"
              value="1"
              checked={
                handle.props.page ? Boolean(handle.props.page.is_public) : true
              }
            />{" "}
            Public
          </span>
        </label>
        <button>Save page</button>
      </form>
    </>
  );
}
export function Forum(
  handle: Handle<{ threads: Row[]; member: Member | null }>,
) {
  return () => (
    <>
      <h1>Forum</h1>
      {handle.props.member ? (
        <a href="/forum/new">New thread</a>
      ) : (
        <p>
          <a href="/auth/start">Sign in</a> to join the conversation.
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>Thread</th>
            <th>Started by</th>
            <th>Replies</th>
          </tr>
        </thead>
        <tbody>
          {handle.props.threads.map((thread) => (
            <tr>
              <td>
                <a href={`/forum/${thread.id}`}>{thread.title}</a>
                {thread.is_locked ? " · locked" : ""}
                {thread.is_pinned ? " · pinned" : ""}
              </td>
              <td>{thread.display_name}</td>
              <td>{thread.reply_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!handle.props.threads.length ? <p>No threads yet.</p> : null}
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
export function Media(
  handle: Handle<{ items: Row[]; storage_used: number; storage_limit: number }>,
) {
  return () => (
    <>
      <h1>Media library</h1>
      <p>
        {Math.ceil(handle.props.storage_used / 1024)} KB used of{" "}
        {handle.props.storage_limit / 1024 / 1024} MB.
      </p>
      <form
        method="post"
        action="/settings/media/upload"
        encType="multipart/form-data"
      >
        <label>
          File
          <input type="file" name="file" required />
        </label>
        <button>Upload</button>
        <small>Up to 10 MB per file.</small>
      </form>
      <ul>
        {handle.props.items.map((item) => (
          <li class="row">
            <a href={`/uploads/${item.storage_path}`}>{item.storage_path}</a>
            <span>{item.size_bytes} bytes</span>
            <form method="post" action={`/settings/media/${item.id}/delete`}>
              <button>Delete file {item.id}</button>
            </form>
          </li>
        ))}
      </ul>
    </>
  );
}
export function Invites(handle: Handle<{ invites: Row[]; origin: string }>) {
  return () => (
    <>
      <h1>Invites</h1>
      <form method="post" action="/settings/invites">
        <label>
          Maximum uses
          <input
            type="number"
            name="max_uses"
            min={1}
            max={100}
            value="1"
            required
          />
        </label>
        <button>Create invite</button>
      </form>
      <ul>
        {handle.props.invites.map((invite) => (
          <li>
            <a href={`/register?invite=${invite.code}`}>
              {handle.props.origin}/register?invite={invite.code}
            </a>
            <p>
              {invite.uses_count} of {invite.max_uses} used
              {invite.disabled ? " · disabled" : ""}
            </p>
            {!invite.disabled ? (
              <form
                method="post"
                action={`/settings/invites/${invite.id}/disable`}
              >
                <button>Disable invite {invite.id}</button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}

export function BareDocument(
  handle: Handle<{ title: string; children?: RemixNode }>,
) {
  return () => (
    <html lang="en" mix={styles}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>{handle.props.title} · 4orm</title>
      </head>
      <body>{handle.props.children}</body>
    </html>
  );
}
export function rawPage(record: Row, profile: Row) {
  const data = JSON.stringify({
    username: profile.username,
    display_name: profile.display_name,
  }).replace(/</g, "\\u003c");
  return `${content(String(record.content ?? ""), String(record.content_format))}\n<script>window.__4ORM=${data};</script><style>${profile.custom_css ?? ""}</style>${profile.custom_html ?? ""}`;
}
