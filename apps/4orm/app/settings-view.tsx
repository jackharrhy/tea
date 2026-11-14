import type { Handle, RemixNode } from "remix/component";
import type { Community } from "./data/community.ts";
import type { Row } from "./data/community.ts";

function SettingsForm(
  handle: Handle<{
    action: string;
    status: string;
    button: string;
    children?: RemixNode;
    className?: string;
  }>,
) {
  return () => (
    <form
      method="post"
      action={handle.props.action}
      class={handle.props.className ?? "stack"}
      hx-post={handle.props.action}
      hx-target={`#${handle.props.status}`}
      hx-swap="innerHTML"
    >
      {handle.props.children}
      <button>{handle.props.button}</button>
      <span id={handle.props.status} />
    </form>
  );
}
export function ContentEditor(
  handle: Handle<{
    id: string;
    value?: string;
    format?: string;
    rows?: number;
    placeholder?: string;
  }>,
) {
  return () => (
    <div class="content-editor">
      <div class="inline fourm-editor-toolbar">
        {["html", "markdown"].map((format) => (
          <label>
            <input
              type="radio"
              name="content_format"
              value={format}
              checked={(handle.props.format ?? "html") === format}
              data-editor-id={handle.props.id}
              data-editor-lang={format}
            />
            {format}
          </label>
        ))}
      </div>
      <textarea
        id={handle.props.id}
        name="content"
        rows={handle.props.rows ?? 12}
        placeholder={handle.props.placeholder ?? ""}
        data-codemirror={
          handle.props.format === "markdown" ? "markdown" : "html"
        }
        defaultValue={handle.props.value ?? ""}
      />
    </div>
  );
}
export function LayoutSelect(handle: Handle<{ value?: string }>) {
  const options = {
    default: "topbar, panels, structured content",
    simple: "topbar only, blank page",
    raw: "full HTML, no template",
    cssonly: "default CSS and topbar, blank content area",
  };
  return () => (
    <label>
      layout
      <select name="layout">
        {Object.entries(options).map(([value, description]) => (
          <option
            value={value}
            selected={value === (handle.props.value ?? "default")}
          >
            {value} - {description}
          </option>
        ))}
      </select>
    </label>
  );
}
export function MediaPicker(
  handle: Handle<{
    items: Row[];
    editor: string;
    format?: string;
    selected?: string;
  }>,
) {
  return () => (
    <div
      class="media-picker"
      id={`media-picker-${handle.props.editor}`}
      data-state="idle"
    >
      <div class="media-picker-row">
        <div class="media-picker-select">
          {handle.props.items.length ? (
            <>
              <select
                id={`media-select-${handle.props.editor}`}
                data-media-editor={handle.props.editor}
              >
                {handle.props.items.map((item) => (
                  <option
                    value={String(item.storage_path)}
                    selected={
                      String(item.storage_path) === handle.props.selected
                    }
                    data-mime={String(item.mime_type ?? "")}
                    data-alt={String(item.alt_text ?? "")}
                  >
                    {String(item.storage_path).split("/").at(-1)}
                  </option>
                ))}
              </select>
              <div
                class="fourm-actions fourm-space-xs"
                id={`media-buttons-${handle.props.editor}`}
              >
                {[
                  ["img", "img"],
                  ["linked-img", "linked img"],
                  ["video", "video"],
                  ["audio", "audio"],
                  ["link", "link"],
                ].map(([kind, label]) => (
                  <button
                    type="button"
                    class={`btn-sm media-btn-${kind}`}
                    data-media-insert={kind}
                    data-media-editor={handle.props.editor}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p class="muted fourm-empty-compact">no media yet · upload one →</p>
          )}
        </div>
        <div class="media-picker-upload">
          <input
            type="file"
            id={`media-upload-file-${handle.props.editor}`}
            class="fourm-file-compact"
          />
          <button
            type="button"
            class="btn-sm fourm-space-xs"
            data-upload-button
            data-media-upload={handle.props.editor}
            data-media-format={handle.props.format ?? "html"}
          >
            upload
          </button>
          <span
            id={`media-upload-status-${handle.props.editor}`}
            role="status"
            aria-live="polite"
          />
        </div>
      </div>
    </div>
  );
}
export function PagesList(handle: Handle<{ pages: Row[]; username: string }>) {
  return () => (
    <ul>
      {handle.props.pages.length ? (
        handle.props.pages.map((page) => (
          <li id={`page-${page.slug}`}>
            <a href={`/u/${handle.props.username}/page/${page.slug}`}>
              {page.title}
            </a>{" "}
            <span class="muted">({page.is_public ? "public" : "private"})</span>{" "}
            · <a href={`/settings/pages/${page.slug}/edit`}>edit</a> ·{" "}
            <form
              method="post"
              action={`/settings/pages/${page.slug}/delete`}
              class="fourm-inline-form"
              hx-post={`/settings/pages/${page.slug}/delete`}
              hx-target="#pages-section"
              hx-swap="innerHTML"
              hx-confirm={`Delete page '${page.title}'?`}
            >
              <button type="submit" class="fourm-button-link">
                delete
              </button>
            </form>
          </li>
        ))
      ) : (
        <li>no pages yet.</li>
      )}
    </ul>
  );
}
export function PlaylistSettings(
  handle: Handle<{ tracks: Row[]; media: Row[] }>,
) {
  return () => (
    <>
      {handle.props.tracks.length ? (
        <>
          <h3>current playlist</h3>
          <div class="stack">
            {handle.props.tracks.map((track) => (
              <div class="fourm-actions">
                <span>
                  {track.title || String(track.storage_path).split("/").at(-1)}
                </span>
                {["up", "down"].map((direction) => (
                  <form
                    method="post"
                    action={`/settings/player/${track.id}/move`}
                    class="inline"
                    hx-post={`/settings/player/${track.id}/move`}
                    hx-target="#playlist-section"
                    hx-swap="innerHTML"
                  >
                    <input type="hidden" name="direction" value={direction} />
                    <button type="submit" class="btn-sm">
                      {direction === "up" ? "↑" : "↓"}
                    </button>
                  </form>
                ))}
                <form
                  method="post"
                  action={`/settings/player/${track.id}/remove`}
                  class="inline"
                  hx-post={`/settings/player/${track.id}/remove`}
                  hx-target="#playlist-section"
                  hx-swap="innerHTML"
                >
                  <button type="submit" class="btn-sm">
                    remove
                  </button>
                </form>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p class="muted">no tracks yet.</p>
      )}
      {handle.props.media.some((item) =>
        String(item.mime_type).startsWith("audio"),
      ) ? (
        <>
          <h3>add track</h3>
          <form
            method="post"
            action="/settings/player/add"
            class="inline"
            hx-post="/settings/player/add"
            hx-target="#playlist-section"
            hx-swap="innerHTML"
          >
            <select name="media_id">
              {handle.props.media
                .filter((item) => String(item.mime_type).startsWith("audio"))
                .map((item) => (
                  <option value={String(item.id)}>
                    {String(item.storage_path).split("/").at(-1)}
                  </option>
                ))}
            </select>
            <button type="submit">add to playlist</button>
          </form>
        </>
      ) : (
        <p class="muted">
          upload audio files in the <a href="/settings/media">media library</a>{" "}
          first.
        </p>
      )}
    </>
  );
}
export function InvitesSettings(
  handle: Handle<{ invites: ReturnType<Community["invites"]> }>,
) {
  return () => (
    <>
      <form
        method="post"
        action="/settings/invites"
        class="inline"
        hx-post="/settings/invites"
        hx-target="#invites-section"
        hx-swap="innerHTML"
      >
        <label>
          max uses
          <input type="number" name="max_uses" value="1" min="1" max="50" />
        </label>
        <button>create invite</button>
      </form>
      {handle.props.invites.length ? (
        <>
          <h3>your invites</h3>
          <div class="stack">
            {handle.props.invites.map((invite) => {
              const action =
                invite.uses_count === 0 &&
                !invite.pending_reservations &&
                ["active", "expired"].includes(invite.status)
                  ? "delete"
                  : ["active", "exhausted", "reserved", "expired"].includes(
                        invite.status,
                      )
                    ? "disable"
                    : null;
              return (
                <div class="panel fourm-panel-flush">
                  <p>
                    <code>{invite.code}</code>
                    <span class="muted">
                      {" "}
                      · {invite.uses_count}/{invite.max_uses} used ·{" "}
                      {invite.status}
                    </span>
                  </p>
                  {invite.redeemed_by.length ? (
                    <p>
                      used by:{" "}
                      {invite.redeemed_by.map((user, index) => (
                        <>
                          {index ? "," : ""}
                          <a href={`/u/${user.username}`}>
                            {user.display_name}
                          </a>
                        </>
                      ))}
                    </p>
                  ) : null}
                  {action ? (
                    <form
                      method="post"
                      action={`/settings/invites/${invite.id}/${action}`}
                      class="inline"
                      hx-post={`/settings/invites/${invite.id}/${action}`}
                      hx-target="#invites-section"
                      hx-swap="innerHTML"
                      hx-confirm={
                        action === "delete"
                          ? "Delete this unused invite?"
                          : "Disable this invite code?"
                      }
                    >
                      <button type="submit">{action}</button>
                    </form>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </>
  );
}
export function Settings(
  handle: Handle<{
    profile: Row;
    pages: Row[];
    card: Row;
    media: Row[];
    tracks: Row[];
    invites: ReturnType<Community["invites"]>;
    newInvite?: string;
    error?: string;
  }>,
) {
  return () => (
    <>
      <h1>settings</h1>
      {handle.props.newInvite ? (
        <p class="ok">
          new invite code: <code>{handle.props.newInvite}</code>
        </p>
      ) : null}
      {handle.props.error === "slug_taken" ? (
        <p class="error">
          a page with that slug already exists. try a different one.
        </p>
      ) : handle.props.error === "missing_page_fields" ? (
        <p class="error">a page needs both a slug and a title.</p>
      ) : null}
      <p>
        <a href="/settings/media">manage media library →</a> ·{" "}
        <a href="/how-to">how-to guide →</a> ·{" "}
        <a href={`/u/${handle.props.profile.username}/export`}>
          export my site →
        </a>
      </p>
      <section class="panel">
        <h2>profile &amp; appearance</h2>
        <details open>
          <summary>
            <strong>profile</strong>
          </summary>
          <SettingsForm
            action="/settings/profile"
            status="profile-status"
            button="save profile"
          >
            <label>
              display name
              <input
                name="display_name"
                value={String(handle.props.profile.display_name)}
              />
            </label>
            <label>content</label>
            <ContentEditor
              id="profile_content"
              value={String(handle.props.profile.content ?? "")}
              format={String(handle.props.profile.content_format)}
              rows={8}
            />
            <LayoutSelect value={String(handle.props.profile.layout)} />
          </SettingsForm>
          <SettingsForm
            action="/settings/username"
            status="username-status"
            button="save username"
            className="stack fourm-form-section"
          >
            <label>
              username
              <input
                name="username"
                value={String(handle.props.profile.username)}
                required
              />
            </label>
          </SettingsForm>
        </details>
        <details>
          <summary>
            <strong>css</strong>
          </summary>
          <SettingsForm
            action="/settings/css"
            status="css-status"
            button="save css"
          >
            <textarea
              name="custom_css"
              rows={10}
              data-codemirror="css"
              defaultValue={String(handle.props.profile.custom_css ?? "")}
            />
          </SettingsForm>
        </details>
        <details>
          <summary>
            <strong>custom html</strong>
          </summary>
          <p class="muted">
            injected into your profile and pages. supports scripts.
          </p>
          <SettingsForm
            action="/settings/html"
            status="html-status"
            button="save html"
          >
            <textarea
              name="custom_html"
              rows={10}
              data-codemirror="html"
              defaultValue={String(handle.props.profile.custom_html ?? "")}
            />
          </SettingsForm>
        </details>
        <details>
          <summary>
            <strong>profile card</strong>
          </summary>
          <SettingsForm
            action="/settings/card"
            status="card-status"
            button="save card"
          >
            <label>
              headline
              <input
                name="headline"
                value={String(handle.props.card.headline ?? "")}
              />
            </label>
            <label>content</label>
            <ContentEditor
              id="card_content"
              value={String(handle.props.card.content ?? "")}
              format={String(handle.props.card.content_format ?? "html")}
              rows={6}
            />
            <label>
              accent color
              <input
                type="color"
                name="accent_color"
                value={String(handle.props.card.accent_color ?? "#00ffff")}
              />
            </label>
            <label>
              border style
              <select name="border_style">
                {[
                  "solid",
                  "double",
                  "dashed",
                  "dotted",
                  "outset",
                  "inset",
                  "ridge",
                  "groove",
                ].map((style) => (
                  <option
                    selected={
                      style ===
                      String(handle.props.card.border_style ?? "outset")
                    }
                  >
                    {style}
                  </option>
                ))}
              </select>
            </label>
            <label>
              card css
              <textarea
                name="card_css"
                rows={5}
                data-codemirror="css"
                defaultValue={String(handle.props.card.card_css ?? "")}
              />
            </label>
          </SettingsForm>
        </details>
      </section>
      <section class="panel">
        <h2>pages</h2>
        <details open>
          <summary>
            <strong>your pages</strong>
          </summary>
          <div id="pages-section">
            <PagesList
              pages={handle.props.pages}
              username={String(handle.props.profile.username)}
            />
          </div>
        </details>
        <details>
          <summary>
            <strong>create page</strong>
          </summary>
          <form method="post" action="/settings/pages" class="stack">
            <label>
              slug
              <input name="slug" placeholder="about" required />
            </label>
            <label>
              title
              <input name="title" placeholder="about me" required />
            </label>
            <label>content</label>
            <ContentEditor
              id="create_content"
              placeholder="<marquee>hello world</marquee>"
            />
            <LayoutSelect />
            <button>publish</button>
          </form>
          <MediaPicker items={handle.props.media} editor="create_content" />
        </details>
        <p class="muted">
          want to upload right from your computer? try the{" "}
          <a href="/cli">cli</a>.
        </p>
      </section>
      <section class="panel">
        <h2>embeds &amp; widgets</h2>
        <details>
          <summary>
            <strong>guestbook</strong>
          </summary>
          <p class="muted">
            your guestbook lives at{" "}
            <a
              href={`/u/${handle.props.profile.username}/guestbook`}
              target="_blank"
            >
              <code>/u/{handle.props.profile.username}/guestbook</code>
            </a>
            . embed it on any page with:
          </p>
          <pre>
            <code>{`<iframe src="/u/${handle.props.profile.username}/guestbook" style="width:100%; height:400px; border:2px inset #ccc;"></iframe>`}</code>
          </pre>
          <SettingsForm
            action="/settings/guestbook"
            status="guestbook-status"
            button="save guestbook"
          >
            <label>guestbook css</label>
            <textarea
              name="guestbook_css"
              rows={6}
              data-codemirror="css"
              defaultValue={String(handle.props.profile.guestbook_css ?? "")}
            />
            <label>guestbook html</label>
            <textarea
              name="guestbook_html"
              rows={6}
              data-codemirror="html"
              defaultValue={String(handle.props.profile.guestbook_html ?? "")}
            />
          </SettingsForm>
        </details>
        <details>
          <summary>
            <strong>visitor counter</strong>
          </summary>
          <p class="muted">
            your counter lives at{" "}
            <a
              href={`/u/${handle.props.profile.username}/counter`}
              target="_blank"
            >
              <code>/u/{handle.props.profile.username}/counter</code>
            </a>
            . embed it on any page with:
          </p>
          <pre>
            <code>{`<iframe src="/u/${handle.props.profile.username}/counter" style="width:228px; height:63px; border:none;"></iframe>`}</code>
          </pre>
          <SettingsForm
            action="/settings/counter"
            status="counter-status"
            button="save counter"
          >
            <label>counter css</label>
            <textarea
              name="counter_css"
              rows={6}
              data-codemirror="css"
              defaultValue={String(handle.props.profile.counter_css ?? "")}
            />
            <label>counter html</label>
            <textarea
              name="counter_html"
              rows={6}
              data-codemirror="html"
              defaultValue={String(handle.props.profile.counter_html ?? "")}
            />
          </SettingsForm>
        </details>
        <details>
          <summary>
            <strong>webring</strong>
          </summary>
          <p class="muted">
            join the 4orm webring to be discoverable by other members.
          </p>
          <p class="muted">
            <strong>important:</strong> enabling this only opts you in. You must
            also paste the iframe below into one of your public pages, or the
            webring navigation will not appear on your site.
          </p>
          <SettingsForm
            action="/settings/webring"
            status="webring-status"
            button="save"
          >
            <label>
              <input
                type="checkbox"
                name="in_webring"
                checked={Boolean(handle.props.profile.in_webring)}
              />
              join the webring
            </label>
          </SettingsForm>
          <p class="muted fourm-space-sm">embed on your page:</p>
          <pre>
            <code>{`<iframe src="/u/${handle.props.profile.username}/webring" style="width:100%;height:32px;border:none;"></iframe>`}</code>
          </pre>
        </details>
        <details>
          <summary>
            <strong>status / mood</strong>
          </summary>
          <p class="muted">
            set your current status. visible via embeddable badge.
          </p>
          <SettingsForm
            action="/settings/status"
            status="status-status"
            button="save status"
          >
            <label>
              emoji (max 10 chars){" "}
              <input
                name="status_emoji"
                value={String(handle.props.profile.status_emoji ?? "")}
                maxLength={10}
                class="fourm-field-short"
              />
            </label>
            <label>
              status text (max 140 chars)
              <input
                name="status_text"
                value={String(handle.props.profile.status_text ?? "")}
                maxLength={140}
              />
            </label>
            <label>status css</label>
            <textarea
              name="status_css"
              rows={4}
              data-codemirror="css"
              defaultValue={String(handle.props.profile.status_css ?? "")}
            />
            <label>status html</label>
            <textarea
              name="status_html"
              rows={4}
              data-codemirror="html"
              defaultValue={String(handle.props.profile.status_html ?? "")}
            />
          </SettingsForm>
          <p class="muted fourm-space-sm">embed on your page:</p>
          <pre>
            <code>{`<iframe src="/u/${handle.props.profile.username}/status" style="width:300px;height:32px;border:none;"></iframe>`}</code>
          </pre>
        </details>
        <details>
          <summary>
            <strong>music player</strong>
          </summary>
          <p class="muted">create a playlist from your audio uploads.</p>
          <div id="playlist-section">
            <PlaylistSettings
              tracks={handle.props.tracks}
              media={handle.props.media}
            />
          </div>
          <SettingsForm
            action="/settings/player"
            status="player-status"
            button="save player styling"
            className="stack fourm-form-section"
          >
            <label>player css</label>
            <textarea
              name="player_css"
              rows={4}
              data-codemirror="css"
              defaultValue={String(handle.props.profile.player_css ?? "")}
            />
            <label>player html</label>
            <textarea
              name="player_html"
              rows={4}
              data-codemirror="html"
              defaultValue={String(handle.props.profile.player_html ?? "")}
            />
          </SettingsForm>
          <p class="muted fourm-space-sm">embed on your page:</p>
          <pre>
            <code>{`<iframe src="/u/${handle.props.profile.username}/player" style="width:300px;height:200px;border:2px inset #ccc;"></iframe>`}</code>
          </pre>
        </details>
      </section>
      <section class="panel">
        <h2>community</h2>
        <details>
          <summary>
            <strong>invites</strong>
          </summary>
          <div id="invites-section">
            <InvitesSettings invites={handle.props.invites} />
          </div>
        </details>
        <details>
          <summary>
            <strong>notifications</strong>
          </summary>
          <p class="muted">
            push notifications for thread replies, quotes, and guestbook
            entries.
          </p>
          <SettingsForm
            action="/settings/notifications"
            status="notif-status"
            button="save"
          >
            <label>
              <input
                type="checkbox"
                name="notifications_enabled"
                checked={Boolean(handle.props.profile.notifications_enabled)}
              />
              enable push notifications
            </label>
            <label>
              <input
                type="checkbox"
                name="watch_all_threads"
                checked={Boolean(handle.props.profile.watch_all_threads)}
              />
              auto-watch all forum threads
            </label>
          </SettingsForm>
          <form
            method="post"
            action="/settings/notifications/test"
            class="inline fourm-space-sm"
            hx-post="/settings/notifications/test"
            hx-target="#notif-test-status"
            hx-swap="innerHTML"
          >
            <button type="submit" class="btn-sm">
              send test notification
            </button>
            <span id="notif-test-status" />
          </form>
          <h3 class="fourm-space-md">registered devices</h3>
          <p id="push-status" role="status" aria-live="polite" />
          <div id="push-devices">
            <button
              class="btn-sm"
              hx-get="/api/push/devices"
              hx-target="#push-devices"
              hx-swap="innerHTML"
            >
              load devices
            </button>
          </div>
        </details>
        <details>
          <summary>
            <strong>forum signature</strong>
          </summary>
          <p class="muted">
            <a
              href="https://www.phpbb.com/community/help/bbcode"
              target="_blank"
            >
              BBCode
            </a>{" "}
            signature shown below your forum posts. max 200 characters.
          </p>
          <SettingsForm
            action="/settings/signature"
            status="sig-status"
            button="save signature"
          >
            <textarea
              name="forum_signature"
              rows={3}
              maxLength={200}
              defaultValue={String(handle.props.profile.forum_signature ?? "")}
            />
          </SettingsForm>
        </details>
      </section>
      <script type="module" src="/static/codemirror.js" />
    </>
  );
}
