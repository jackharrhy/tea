import { renderToString } from "remix/component/server";
import { LocalTime } from "./time.tsx";
import { unsafeHTML } from "remix/component";
import type { Handle } from "remix/component";
import type { Member, Row } from "./data/community.ts";

const guestbookStyles =
  "\n      @layer base {\n        * { box-sizing: border-box; margin: 0; }\n        body {\n          font-family: Verdana, Tahoma, Arial, sans-serif;\n          font-size: 13px;\n          background: #ffffee;\n          color: #333;\n          padding: 10px;\n          line-height: 1.4;\n        }\n        h2 { font-size: 14px; margin-bottom: 8px; color: #000; }\n        a { color: #0000ee; }\n        a:visited { color: #551a8b; }\n        .gb-entry { border-bottom: 1px dashed #ccc; padding: 6px 0; }\n        .gb-entry:last-child { border-bottom: none; }\n        .gb-meta { font-size: 11px; color: #666; display: flex; align-items: center; gap: 6px; }\n        .gb-date { color: #999; }\n        .gb-message { margin-top: 2px; word-break: break-word; white-space: pre-wrap; font-family: monospace; }\n        .gb-empty { color: #999; font-style: italic; }\n        .gb-inline { display: inline; }\n        .gb-delete {\n          background: none; border: none; color: #cc0000;\n          cursor: pointer; font-size: 11px; padding: 0; text-decoration: underline;\n        }\n        .gb-form { margin-top: 10px; border-top: 2px solid #ccc; padding-top: 8px; }\n        .gb-form textarea { width: 100%; font: inherit; border: 2px inset #ccc; padding: 4px; resize: vertical; }\n        .gb-form button { margin-top: 4px; font: inherit; border: 2px outset #ccc; background: #eee; padding: 3px 10px; cursor: pointer; }\n        .gb-signin { color: #999; margin-top: 10px; font-size: 12px; }\n        .gb-signin a { color: #0000ee; }\n      }\n      ";
export function GuestbookEntries(
  handle: Handle<{ owner: Row; entries: Row[]; member: Member | null }>,
) {
  return () => (
    <>
      {handle.props.entries.length ? (
        handle.props.entries.map((entry) => (
          <div class="gb-entry" id={`gb-entry-${entry.id}`}>
            <p class="gb-meta">
              <a href={`/u/${entry.username}`} target="_parent">
                <strong>{entry.display_name}</strong>
              </a>
              <span class="gb-date">
                <LocalTime value={entry.created_at} />
              </span>
              {handle.props.member?.id === handle.props.owner.id ? (
                <form
                  method="post"
                  action={`/u/${handle.props.owner.username}/guestbook/${entry.id}/delete`}
                  class="gb-inline"
                  hx-post={`/u/${handle.props.owner.username}/guestbook/${entry.id}/delete`}
                  hx-target="#gb-entries"
                  hx-swap="innerHTML"
                  hx-confirm="Delete this entry?"
                >
                  <button type="submit" class="gb-delete">
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
    </>
  );
}
function Guestbook(
  handle: Handle<{ owner: Row; entries: Row[]; member: Member | null }>,
) {
  return () => (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{handle.props.owner.display_name}'s guestbook</title>
        <script src="/static/htmx.min.js" />
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
            hx-post={`/u/${handle.props.owner.username}/guestbook`}
            hx-target="#gb-entries"
            hx-swap="innerHTML"
            hx-on--after-request="if(event.detail.successful) this.reset()"
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
          <GuestbookEntries {...handle.props} />
        </div>
      </body>
    </html>
  );
}
export async function guestbookDocument(props: {
  owner: Row;
  entries: Row[];
  member: Member | null;
}) {
  const html =
    "<!doctype html>" + (await renderToString(<Guestbook {...props} />));
  const end = html.lastIndexOf("</body>");
  return (
    html.slice(0, end) +
    String(props.owner.guestbook_html ?? "") +
    html.slice(end)
  );
}
