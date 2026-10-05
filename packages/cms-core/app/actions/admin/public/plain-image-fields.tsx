import { on, type Handle } from "remix/component";
import type { ContentBlock, Media } from "../../../ui/public/content-types.ts";
import { MediaPicker } from "./media-picker.tsx";

export function PlainImageFields(
  handle: Handle<{
    block: ContentBlock;
    media: Media[];
    change: () => void;
    previewLayout?: { width: number; fontSize: number };
  }>,
) {
  let picking = false;
  function set(key: string, value: string) {
    handle.props.block.props[key] = value;
    handle.props.change();
    handle.update();
  }
  return () => {
    const p = handle.props.block.props;
    return (
      <div className="image-block">
        <div className="image-block-preview">
          {p.mediaId ? (
            <img
              src={"/tea/api/media/file/" + p.mediaId}
              alt={p.alt ?? ""}
              style={{ maxHeight: 240, maxWidth: "100%", objectFit: "contain" }}
            />
          ) : (
            <p className="muted">No image selected.</p>
          )}
          <button
            type="button"
            className="button"
            mix={on("click", () => {
              picking = true;
              handle.update();
            })}
          >
            {p.mediaId ? "Change image" : "Choose image"}
          </button>
        </div>
        <label>
          Alternative text
          <input
            value={p.alt ?? ""}
            mix={on("input", (e) => set("alt", e.currentTarget.value))}
          />
        </label>
        <label>
          Image role
          <select
            value={p.role ?? "image"}
            mix={on<HTMLSelectElement>("change", (e) =>
              set("role", e.currentTarget.value),
            )}
          >
            <option value="image">Page image</option>
            <option value="background">Homepage background</option>
          </select>
        </label>
        <label>
          Width (optional)
          <input
            placeholder="e.g. 100% or 480px"
            value={p.width ?? ""}
            mix={on("input", (e) => set("width", e.currentTarget.value))}
          />
        </label>
        {picking && (
          <MediaPicker
            media={handle.props.media}
            choose={(m) => {
              p.mediaId = m.id;
              p.alt = m.alt ?? "";
              delete p.naturalWidth;
              delete p.naturalHeight;
              const image = new Image();
              image.addEventListener(
                "load",
                () => {
                  if (!handle.signal.aborted && p.mediaId === m.id) {
                    p.naturalWidth = image.naturalWidth;
                    p.naturalHeight = image.naturalHeight;
                    handle.props.change();
                    handle.update();
                  }
                },
                { once: true, signal: handle.signal },
              );
              image.src = "/tea/api/media/file/" + m.id;
              picking = false;
              handle.props.change();
              handle.update();
            }}
            close={() => {
              picking = false;
              handle.update();
            }}
          />
        )}
      </div>
    );
  };
}
