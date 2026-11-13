import { chatStyle } from "./chat-style.ts";
import { LocalTime } from "./time.tsx";
import { unsafeHTML } from "remix/component";
import type { Handle } from "remix/component";
import type { Row } from "./data/community.ts";
import { content, postContent } from "./rendering.ts";

function escape(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function cardDocument(card: Row) {
  return `<!doctype html><html><head><style>
@layer base {
  *, *::before, *::after { box-sizing: border-box; }
  * { margin: 0; }
  body { font-family: Verdana, Tahoma, Arial, sans-serif; background: ${card.accent_color}; color: #111; line-height: 1.45; border: 3px ${card.border_style} #333; padding: 10px; height: 100vh; overflow: hidden; }
  h2 { margin: 0 0 6px; font-size: 1rem; line-height: 1.2; }
  p { margin: 0 0 6px; font-size: 0.85rem; }
  a { color: #0000ee; } a:visited { color: #551a8b; } a:hover { color: #ff0000; }
  .muted { color: #333; font-size: 0.8rem; }
}
${card.card_css ?? ""}</style></head><body>
<h2><a href="/u/${escape(card.username)}" target="_parent">${escape(card.headline)}</a></h2>
${content(String(card.content ?? ""), String(card.content_format))}
</body></html>`;
}
export function Home(handle: Handle<{ cards: Row[]; recent: Row[] }>) {
  const style = chatStyle();
  return () => (
    <>
      <p class="fourm-home-chat">
        <a href="/chat" style={style}>
          chat
        </a>
      </p>
      {handle.props.recent.length ? (
        <section class="panel">
          <h2>recent forum activity</h2>
          {handle.props.recent.map((post) => (
            <div class="forum-post fourm-activity-item">
              <div class="forum-post-meta">
                <a href={`/u/${post.author_username}`}>
                  <strong>
                    {post.author_display_name || post.author_username}
                  </strong>
                </a>
                {post.quoted_author
                  ? ` ↩ replying to ${post.quoted_author} in `
                  : " in "}
                <a href={`/forum/${post.thread_id}#post-${post.id}`}>
                  {post.thread_title}
                </a>{" "}
                · <LocalTime value={post.created_at} format="relative" />
              </div>
              <div class="fourm-activity-preview">
                {postContent(String(post.content), String(post.content_format))
                  .replace(/<[^>]*>/g, "")
                  .slice(0, 200)}
              </div>
            </div>
          ))}
          <p class="fourm-space-xs">
            <a href="/forum">view all threads →</a>
          </p>
        </section>
      ) : null}
      <div class="cards">
        {handle.props.cards.length ? (
          handle.props.cards.map((card) => (
            <iframe
              class="card-frame"
              sandbox="allow-top-navigation-by-user-activation"
              srcDoc={unsafeHTML(cardDocument(card))}
            />
          ))
        ) : (
          <p>no users yet.</p>
        )}
      </div>
    </>
  );
}
