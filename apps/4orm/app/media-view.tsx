import type { Handle } from "remix/component";
import type { Row } from "./data/community.ts";

export function humanBytes(size: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size,
    index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  const tenths = value * 10,
    lower = Math.floor(tenths);
  const rounded =
    tenths - lower === 0.5 ? lower + (lower % 2) : Math.round(tenths);
  return `${index ? (rounded / 10).toFixed(1) : Math.trunc(value)} ${units[index]}`;
}

export function MediaCard(handle: Handle<{ item: Row }>) {
  return () => {
    const item = handle.props.item,
      name = String(item.storage_path).split("/").at(-1),
      mime = String(item.mime_type),
      src = `/uploads/${item.storage_path}`;
    return (
      <details id={`media-${item.id}`} class="media-item">
        <summary>
          {"\n    "}
          <code>{name}</code>
          {"\n    "}
          <span class="muted">
            · {mime} · {humanBytes(Number(item.size_bytes))}
          </span>
          {"\n  "}
        </summary>
        <div class="media-item-body">
          {mime.startsWith("image/") ? (
            <img
              src={src}
              alt={String(item.alt_text ?? "")}
              class="fourm-media-preview"
            />
          ) : mime.startsWith("video/") ? (
            <video controls src={src} class="fourm-media-preview" />
          ) : mime.startsWith("audio/") ? (
            <audio controls src={src} />
          ) : (
            <p>
              <a href={src}>download file</a>
            </p>
          )}
          <p class="muted fourm-space-xs">
            <code>{src}</code>
          </p>
          <div class="stack fourm-space-xs">
            <form
              method="post"
              action={`/settings/media/${item.id}/rename`}
              class="inline"
              hx-post={`/settings/media/${item.id}/rename`}
              hx-target={`#media-${item.id}`}
              hx-swap="outerHTML"
            >
              <input
                name="filename"
                value={name}
                required
                class="fourm-field-medium"
              />
              <button type="submit" class="btn-sm">
                rename
              </button>
            </form>
            <form
              method="post"
              action={`/settings/media/${item.id}/alt`}
              class="inline"
              hx-post={`/settings/media/${item.id}/alt`}
              hx-target={`#media-${item.id}`}
              hx-swap="outerHTML"
            >
              <input
                name="alt_text"
                value={String(item.alt_text ?? "")}
                placeholder="alt text"
                class="fourm-field-medium"
              />
              <button type="submit" class="btn-sm">
                save alt
              </button>
            </form>
            <form
              method="post"
              action={`/settings/media/${item.id}/delete`}
              class="inline"
              hx-post={`/settings/media/${item.id}/delete`}
              hx-target={`#media-${item.id}`}
              hx-swap="outerHTML"
              hx-confirm="Delete this media?"
            >
              <button type="submit" class="btn-sm">
                delete
              </button>
            </form>
          </div>
        </div>
      </details>
    );
  };
}

export function MediaLibrary(
  handle: Handle<{
    items: Row[];
    storage_used: number;
    storage_limit: number;
    storage_pct: number;
    error?: string;
  }>,
) {
  return () => (
    <>
      <h1>media library</h1>
      <p>
        <a href="/settings">← back to settings</a>
      </p>
      {handle.props.error === "too_big" && (
        <p class="error">
          That file is too big (max 10 MB). If you really want to upload it,
          reach out to harrhy and we can discuss raising the limit.
        </p>
      )}
      {handle.props.error === "storage_full" && (
        <p class="error">
          You've reached your storage limit (
          {humanBytes(handle.props.storage_limit)}). Delete some files to free
          up space.
        </p>
      )}
      {handle.props.storage_pct >= 70 && (
        <p class={handle.props.storage_pct >= 90 ? "error" : "muted"}>
          storage: {humanBytes(handle.props.storage_used)} /{" "}
          {humanBytes(handle.props.storage_limit)} (
          {Math.trunc(handle.props.storage_pct)}%)
        </p>
      )}
      <section class="panel">
        <h2>upload</h2>
        <form
          method="post"
          action="/settings/media/upload"
          encType="multipart/form-data"
          class="fourm-actions"
          hx-post="/settings/media/upload"
          hx-target="#media-list"
          hx-swap="beforeend"
          hx-encoding="multipart/form-data"
        >
          <input type="file" name="file" required />
          <input
            name="filename"
            placeholder="filename (optional)"
            class="fourm-field-upload"
          />
          <button type="submit">upload</button>
        </form>
      </section>
      <section class="panel">
        <h2>your uploads ({handle.props.items.length})</h2>
        <div id="media-list" class="stack">
          {handle.props.items.length ? (
            handle.props.items.map((item) => <MediaCard item={item} />)
          ) : (
            <p class="muted">no media yet.</p>
          )}
        </div>
      </section>
    </>
  );
}
