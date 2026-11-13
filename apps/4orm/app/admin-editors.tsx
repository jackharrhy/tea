import type { Handle } from "remix/component";
import type { Row } from "./data/community.ts";
export function AdminEditors(
  handle: Handle<{ users: Row[]; cards: Row[]; pages: Row[] }>,
) {
  return () => (
    <>
      <details class="panel">
        <summary>
          <h2>edit user profiles</h2>
        </summary>
        {handle.props.users.map((u) => (
          <details class="panel fourm-panel-nested">
            <summary>
              <strong>@{u.username}</strong> profile
            </summary>
            <form
              method="post"
              action={`/admin/users/${u.id}/profile`}
              class="stack fourm-form-section"
            >
              <label>
                display name
                <input
                  name="display_name"
                  defaultValue={String(u.display_name ?? "")}
                />
              </label>
              <label>
                content format
                <select name="content_format">
                  <option
                    value="markdown"
                    selected={
                      String(u.content_format || "markdown") === "markdown"
                    }
                  >
                    markdown
                  </option>
                  <option
                    value="html"
                    selected={String(u.content_format || "markdown") === "html"}
                  >
                    html
                  </option>
                </select>
              </label>
              <label>
                profile content
                <textarea
                  name="content"
                  rows={5}
                  defaultValue={String(u.content ?? "")}
                />
              </label>
              <label>
                css
                <textarea
                  name="custom_css"
                  rows={4}
                  defaultValue={String(u.custom_css ?? "")}
                />
              </label>
              <label>
                custom html
                <textarea
                  name="custom_html"
                  rows={4}
                  defaultValue={String(u.custom_html ?? "")}
                />
              </label>
              <label>
                layout
                <select name="layout">
                  {["default", "simple", "raw"].map((opt) => (
                    <option
                      value={opt}
                      selected={opt === String(u.layout || "default")}
                    >
                      {opt}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit">save profile</button>
            </form>
          </details>
        ))}
      </details>
      <details class="panel">
        <summary>
          <h2>edit cards</h2>
        </summary>
        {handle.props.users.map((u) => {
          const card = handle.props.cards.find((c) => c.user_id === u.id);
          return card ? (
            <details class="panel fourm-panel-nested">
              <summary>
                <strong>@{u.username}</strong> card
              </summary>
              <form
                method="post"
                action={`/admin/users/${u.id}/card`}
                class="stack fourm-form-section"
              >
                <label>
                  headline
                  <input
                    name="headline"
                    defaultValue={String(card.headline ?? "")}
                  />
                </label>
                <label>
                  content format
                  <select name="content_format">
                    <option
                      value="markdown"
                      selected={
                        String(card.content_format || "markdown") === "markdown"
                      }
                    >
                      markdown
                    </option>
                    <option
                      value="html"
                      selected={
                        String(card.content_format || "markdown") === "html"
                      }
                    >
                      html
                    </option>
                  </select>
                </label>
                <label>
                  content
                  <textarea
                    name="content"
                    rows={4}
                    defaultValue={String(card.content ?? "")}
                  />
                </label>
                <label>
                  accent color
                  <input
                    type="color"
                    name="accent_color"
                    defaultValue={String(card.accent_color || "#00ffff")}
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
                    ].map((b) => (
                      <option
                        value={b}
                        selected={b === String(card.border_style || "outset")}
                      >
                        {b}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  card css
                  <textarea
                    name="card_css"
                    rows={4}
                    defaultValue={String(card.card_css ?? "")}
                  />
                </label>
                <button type="submit">save card</button>
              </form>
            </details>
          ) : null;
        })}
      </details>
      <details class="panel">
        <summary>
          <h2>edit pages</h2>
        </summary>
        {handle.props.pages.map((p) => (
          <details class="panel fourm-panel-nested">
            <summary>
              <strong>@{p.username}</strong> / {p.slug}{" "}
              <span class="muted">({p.is_public ? "public" : "private"})</span>
            </summary>
            <form
              method="post"
              action={`/admin/pages/${p.id}`}
              class="stack fourm-form-section"
            >
              <label>
                slug
                <input name="slug" defaultValue={String(p.slug)} required />
              </label>
              <label>
                title
                <input name="title" defaultValue={String(p.title)} required />
              </label>
              <label>
                content format
                <select name="content_format">
                  <option
                    value="html"
                    selected={String(p.content_format || "html") === "html"}
                  >
                    html
                  </option>
                  <option
                    value="markdown"
                    selected={String(p.content_format || "html") === "markdown"}
                  >
                    markdown
                  </option>
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  name="is_public"
                  checked={Boolean(p.is_public)}
                />{" "}
                public
              </label>
              <label>
                content
                <textarea
                  name="content"
                  rows={8}
                  defaultValue={String(p.content ?? "")}
                />
              </label>
              <button type="submit">save page</button>
            </form>
          </details>
        ))}
      </details>
    </>
  );
}
