import { unsafeHTML } from "remix/component";
import type { Handle } from "remix/component";
import type { Member, Row } from "./data/community.ts";
import { content } from "./rendering.ts";

export function Guestbook(
  handle: Handle<{ owner: Row; entries: Row[]; member: Member | null }>,
) {
  return () => (
    <>
      <h1>{handle.props.owner.display_name}'s guestbook</h1>
      {handle.props.entries.map((entry) => (
        <article>
          <p>
            <a href={`/u/${entry.username}`}>{entry.display_name}</a>{" "}
            <small>{entry.created_at}</small>
          </p>
          <p>{entry.message}</p>
          {handle.props.member?.id === handle.props.owner.id ? (
            <form
              method="post"
              action={`/u/${handle.props.owner.username}/guestbook/${entry.id}/delete`}
            >
              <button>Remove entry {entry.id}</button>
            </form>
          ) : null}
        </article>
      ))}
      {handle.props.member ? (
        <form method="post">
          <label htmlFor="message">Message</label>
          <textarea id="message" name="message" required maxLength={500} />
          <button>Sign guestbook</button>
        </form>
      ) : (
        <p>
          <a href="/auth/start">Sign in</a> to leave a message.
        </p>
      )}
    </>
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
