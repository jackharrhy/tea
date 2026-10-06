import { on, ref, type Handle } from "remix/component";
import type { Media } from "../../../ui/public/content-types.ts";

export function MediaPicker(
  handle: Handle<{
    media: Media[];
    choose: (media: Media) => void;
    close: () => void;
  }>,
) {
  let query = "",
    folder = "all";
  return () => (
    <dialog
      className="media-dialog"
      aria-label="Choose an image"
      mix={[
        ref((node) => node.showModal()),
        on("cancel", () => handle.props.close()),
      ]}
    >
      <div className="section-heading">
        <h2>Choose an image</h2>
        <button
          type="button"
          className="button"
          mix={on("click", () => handle.props.close())}
        >
          Close
        </button>
      </div>
      <input
        type="search"
        aria-label="Search images"
        placeholder="Filename or alt text"
        mix={on("input", (event) => {
          query = event.currentTarget.value;
          handle.update();
        })}
      />
      <select
        aria-label="Image folder"
        value={folder}
        mix={on<HTMLSelectElement>("change", (e) => {
          folder = e.currentTarget.value;
          handle.update();
        })}
      >
        <option value="all">All folders</option>
        <option value="unfiled">Unfiled</option>
        {[
          ...new Map(
            handle.props.media
              .filter((m) => m.folder_id)
              .map((m) => [m.folder_id!, m.folder_path ?? "Folder"]),
          ).entries(),
        ].map(([id, path]) => (
          <option value={id}>{path}</option>
        ))}
      </select>
      <div className="picker-grid">
        {handle.props.media
          .filter(
            (m) =>
              m.mime_type.startsWith("image/") &&
              (folder === "all" ||
                (folder === "unfiled" && !m.folder_id) ||
                m.folder_id === folder) &&
              (m.filename + " " + m.alt)
                .toLowerCase()
                .includes(query.toLowerCase()),
          )
          .map((m) => (
            <button
              type="button"
              className="picker-image"
              mix={on("click", () => handle.props.choose(m))}
            >
              <img
                src={"/tea/api/media/file/" + m.id}
                alt={m.alt ?? m.filename}
                loading="lazy"
              />
              <span>{m.filename}</span>
            </button>
          ))}
      </div>
      <p className="muted">
        <a href="/tea/admin/media" target="_blank">
          Upload a file
        </a>
        , then save your edits and reload this page.
      </p>
    </dialog>
  );
}
