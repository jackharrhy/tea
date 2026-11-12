import { unsafeHTML } from "remix/component";
import type { Handle } from "remix/component";
import type { Member, Row } from "./data/community.ts";
import { content } from "./rendering.ts";

const guestbookStyles =
  "\n      @layer base {\n        * { box-sizing: border-box; margin: 0; }\n        body {\n          font-family: Verdana, Tahoma, Arial, sans-serif;\n          font-size: 13px;\n          background: #ffffee;\n          color: #333;\n          padding: 10px;\n          line-height: 1.4;\n        }\n        h2 { font-size: 14px; margin-bottom: 8px; color: #000; }\n        a { color: #0000ee; }\n        a:visited { color: #551a8b; }\n        .gb-entry { border-bottom: 1px dashed #ccc; padding: 6px 0; }\n        .gb-entry:last-child { border-bottom: none; }\n        .gb-meta { font-size: 11px; color: #666; display: flex; align-items: center; gap: 6px; }\n        .gb-date { color: #999; }\n        .gb-message { margin-top: 2px; word-break: break-word; white-space: pre-wrap; font-family: monospace; }\n        .gb-empty { color: #999; font-style: italic; }\n        .gb-inline { display: inline; }\n        .gb-delete {\n          background: none; border: none; color: #cc0000;\n          cursor: pointer; font-size: 11px; padding: 0; text-decoration: underline;\n        }\n        .gb-form { margin-top: 10px; border-top: 2px solid #ccc; padding-top: 8px; }\n        .gb-form textarea { width: 100%; font: inherit; border: 2px inset #ccc; padding: 4px; resize: vertical; }\n        .gb-form button { margin-top: 4px; font: inherit; border: 2px outset #ccc; background: #eee; padding: 3px 10px; cursor: pointer; }\n        .gb-signin { color: #999; margin-top: 10px; font-size: 12px; }\n        .gb-signin a { color: #0000ee; }\n      }\n      ";
export function Guestbook(
  handle: Handle<{ owner: Row; entries: Row[]; member: Member | null }>,
) {
  return () => (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{handle.props.owner.display_name}'s guestbook</title>
        <style
          innerHTML={unsafeHTML(
            guestbookStyles + String(handle.props.owner.guestbook_css ?? ""),
          )}
        />
      </head>
      <body>
        <h2>{handle.props.owner.display_name}'s guestbook</h2>
        {handle.props.member ? (
          <form
            class="gb-form"
            method="post"
            action={`/u/${handle.props.owner.username}/guestbook`}
          >
            <textarea
              name="message"
              rows={3}
              maxLength={500}
              placeholder="sign the guestbook..."
              required
            />
            <button type="submit">sign</button>
          </form>
        ) : (
          <p class="gb-signin">
            <a href="/login" target="_parent">
              sign in
            </a>{" "}
            to leave a message
          </p>
        )}
        <div id="gb-entries">
          {handle.props.entries.length ? (
            handle.props.entries.map((entry) => (
              <div class="gb-entry" id={`gb-entry-${entry.id}`}>
                <p class="gb-meta">
                  <a href={`/u/${entry.username}`} target="_parent">
                    <strong>{entry.display_name}</strong>
                  </a>
                  <span class="gb-date">{entry.created_at}</span>
                  {handle.props.member?.id === handle.props.owner.id ? (
                    <form
                      method="post"
                      action={`/u/${handle.props.owner.username}/guestbook/${entry.id}/delete`}
                      class="gb-inline"
                    >
                      <button class="gb-delete" type="submit">
                        x
                      </button>
                    </form>
                  ) : null}
                </p>
                <p class="gb-message">{entry.message}</p>
              </div>
            ))
          ) : (
            <p class="gb-empty">no entries yet. be the first to sign!</p>
          )}
        </div>
        <div
          innerHTML={unsafeHTML(
            String(handle.props.owner.guestbook_html ?? ""),
          )}
        />
      </body>
    </html>
  );
}
export function Player(handle: Handle<{ tracks: Row[] }>) {
  return () => (
    <>
      <h1>Playlist</h1>
      {handle.props.tracks.length ? (
        <ol>
          {handle.props.tracks.map((track) => (
            <li>
              <p>{track.title || track.storage_path}</p>
              <audio
                controls
                preload="none"
                src={`/uploads/${track.storage_path}`}
              />
            </li>
          ))}
        </ol>
      ) : (
        <p>No tracks yet.</p>
      )}
    </>
  );
}
export function WidgetSettings(
  handle: Handle<{
    profile: Row;
    tracks: Row[];
    media: Row[];
    card: Row;
    inWebring: boolean;
  }>,
) {
  return () => (
    <>
      <h1>Widgets and profile card</h1>
      <h2>Avatar</h2>
      <form method="post" action="/settings/avatar">
        <label htmlFor="avatar-image">Avatar image</label>
        <select id="avatar-image" name="media_id">
          <option value="" selected={!handle.props.profile.avatar_media_id}>
            No avatar
          </option>
          {handle.props.media
            .filter((item) => String(item.mime_type).startsWith("image/"))
            .map((item) => (
              <option
                value={String(item.id)}
                selected={item.id === handle.props.profile.avatar_media_id}
              >
                {item.storage_path}
              </option>
            ))}
        </select>
        <button>Save avatar</button>
      </form>
      <h2>Status</h2>
      <form method="post" action="/settings/status">
        <label>
          Emoji
          <input
            name="status_emoji"
            maxLength={10}
            value={String(handle.props.profile.status_emoji ?? "")}
          />
        </label>
        <label>
          Status
          <input
            name="status_text"
            maxLength={140}
            value={String(handle.props.profile.status_text ?? "")}
          />
        </label>
        <button>Save status</button>
      </form>
      <h2>Webring</h2>
      <form method="post" action="/settings/webring">
        <label>
          <span>
            <input
              type="checkbox"
              name="enabled"
              value="1"
              checked={handle.props.inWebring}
            />{" "}
            Join the webring
          </span>
        </label>
        <button>Save webring preference</button>
      </form>
      <h2>Playlist</h2>
      <form method="post" action="/settings/player/add">
        <label>
          Media
          <select name="media_id" required>
            {handle.props.media.map((item) => (
              <option value={String(item.id)}>{item.storage_path}</option>
            ))}
          </select>
        </label>
        <label>
          Track title
          <input name="title" maxLength={200} />
        </label>
        <button>Add track</button>
      </form>
      <ol>
        {handle.props.tracks.map((track) => (
          <li>
            {track.title || track.storage_path}
            <div class="row">
              <form method="post" action={`/settings/player/${track.id}/move`}>
                <button name="direction" value="up">
                  Move up
                </button>
                <button name="direction" value="down">
                  Move down
                </button>
              </form>
              <form
                method="post"
                action={`/settings/player/${track.id}/remove`}
              >
                <button>Remove track {track.id}</button>
              </form>
            </div>
          </li>
        ))}
      </ol>
      <h2>Profile card</h2>
      <form method="post" action="/settings/card">
        <label>
          Headline
          <input
            name="headline"
            maxLength={120}
            value={String(handle.props.card.headline ?? "")}
          />
        </label>
        <label htmlFor="card-content">Card content</label>
        <textarea
          id="card-content"
          name="content"
          defaultValue={String(handle.props.card.content ?? "")}
        />
        <label>
          Format
          <select aria-label="Format" name="content_format">
            <option
              value="html"
              selected={(handle.props.card.content_format ?? "html") === "html"}
            >
              HTML
            </option>
            <option
              value="markdown"
              selected={
                (handle.props.card.content_format ?? "html") === "markdown"
              }
            >
              Markdown
            </option>
          </select>
        </label>
        <label>
          Accent color
          <input
            name="accent_color"
            value={String(handle.props.card.accent_color ?? "#00ffff")}
          />
        </label>
        <label htmlFor="card_css">Card CSS</label>
        <textarea
          id="card_css"
          aria-label="Card CSS"
          name="card_css"
          defaultValue={String(handle.props.card.card_css ?? "")}
        />
        <button>Save profile card</button>
      </form>
    </>
  );
}
export function PublicCards(handle: Handle<{ cards: Row[] }>) {
  return () => (
    <section aria-label="Member cards">
      {handle.props.cards.map((card) => (
        <article
          id={`member-card-${card.user_id}`}
          style={{
            borderColor: String(card.accent_color ?? "#00ffff"),
            borderStyle: String(card.border_style ?? "outset"),
          }}
        >
          <h2>
            <a href={`/u/${card.username}`}>
              {card.headline || card.display_name}
            </a>
          </h2>
          <div
            innerHTML={unsafeHTML(
              content(String(card.content ?? ""), String(card.content_format)),
            )}
          />
          <style innerHTML={unsafeHTML(String(card.card_css ?? ""))} />
        </article>
      ))}
    </section>
  );
}
