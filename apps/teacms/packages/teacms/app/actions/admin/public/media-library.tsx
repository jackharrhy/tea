import { clientEntry, on, type Handle } from "remix/component";
import { Folders, folderPath } from "./folders.tsx";
import type { Media, MediaFolder } from "../../../ui/public/content-types.ts";

export const MediaLibrary = clientEntry(
  import.meta.url,
  function MediaLibrary(
    handle: Handle<{
      media: Media[];
      folders: MediaFolder[];
      adornmentMedia: string[];
      references: Record<string, string[]>;
    }>,
  ) {
    let folders = handle.props.folders,
      folder = "all";
    let files = handle.props.media,
      query = "",
      filter = "all",
      selected: Media | null = null,
      status = "",
      error = "",
      uploading = false,
      savingDetails = false;
    async function saveDetails() {
      if (!selected || savingDetails) return;
      const item = { ...selected };
      savingDetails = true;
      error = "";
      handle.update();
      try {
        const response = await fetch("/tea/admin/media/" + item.id, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            alt: item.alt ?? "",
            description: item.description ?? "",
            folder_id: item.folder_id ?? null,
          }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        files = files.map((f) => (f.id === item.id ? result.item : f));
        const changedDuringSave =
          selected?.id === item.id &&
          JSON.stringify(selected) !== JSON.stringify(item);
        if (selected?.id === item.id && !changedDuringSave)
          selected = result.item;
        status = changedDuringSave
          ? "New edits are not saved yet."
          : "File details saved.";
      } catch (e) {
        error = (e as Error).message;
      } finally {
        savingDetails = false;
        handle.update();
      }
    }
    async function upload(file: File) {
      if (uploading) return;
      uploading = true;
      error = "";
      status = "Uploading " + file.name + "…";
      handle.update();
      try {
        const body = new FormData();
        body.set("file", file);
        if (folders.some((f) => f.id === folder)) body.set("folder_id", folder);
        const response = await fetch("/tea/admin/media", {
          method: "POST",
          body,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        files = [result.item, ...files];
        selected = result.item;
        status = "File uploaded.";
      } catch (e) {
        error = (e as Error).message;
        status = "";
      } finally {
        uploading = false;
        handle.update();
      }
    }
    return () => (
      <>
        <div className="page-heading">
          <div>
            <h1>
              Media library<span className="count">{files.length}</span>
            </h1>
          </div>
          <label
            className="button primary upload-button"
            aria-disabled={uploading}
          >
            {uploading ? "Uploading…" : "Upload file"}
            <input
              type="file"
              disabled={uploading}
              accept="image/png,image/jpeg,image/gif,image/webp,image/avif,application/pdf,audio/mpeg,audio/wav,video/mp4"
              mix={on("change", (e) => {
                const file = e.currentTarget.files?.[0];
                if (file) void upload(file);
              })}
            />
          </label>
        </div>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {status && (
          <p className="notice" role="status">
            {status}
          </p>
        )}
        <div className="media-tools">
          <input
            aria-label="Search media"
            type="search"
            placeholder="Filename or alt text"
            mix={on("input", (e) => {
              query = e.currentTarget.value.toLowerCase();
              handle.update();
            })}
          />
          <select
            aria-label="Filter media"
            mix={on<HTMLSelectElement>("change", (e) => {
              filter = e.currentTarget.value;
              handle.update();
            })}
          >
            <option value="all">All files</option>
            <option value="image/">Images</option>
            <option value="audio/">Audio</option>
            <option value="video/">Video</option>
            <option value="application/">Documents</option>
            <option value="missing-alt">Missing alternative text</option>
          </select>
        </div>
        <div className="media-workspace with-folders">
          <Folders
            folders={folders}
            selected={folder}
            select={(id) => {
              folder = id;
              handle.update();
            }}
            change={(value) => {
              folders = value;
              handle.update();
            }}
          />
          <div className="media-content">
            {folders.some((f) => f.id === folder) && (
              <div className="folder-heading">
                <h2>{folderPath(folders, folder)}</h2>
                <p className="muted">
                  {folders.find((f) => f.id === folder)?.description}
                </p>
                <div className="folder-children">
                  {folders
                    .filter((f) => f.parent_id === folder)
                    .map((f) => (
                      <button
                        type="button"
                        className="button small"
                        mix={on("click", () => {
                          folder = f.id;
                          handle.update();
                        })}
                      >
                        ▱ {f.name}
                      </button>
                    ))}
                </div>
              </div>
            )}
            <div
              className="media-grid"
              mix={[
                on("dragover", (e) => e.preventDefault()),
                on("drop", (e) => {
                  e.preventDefault();
                  const file = e.dataTransfer?.files[0];
                  if (file) void upload(file);
                }),
              ]}
            >
              {files
                .filter(
                  (m) =>
                    (m.filename + " " + m.alt + " " + m.description)
                      .toLowerCase()
                      .includes(query) &&
                    (folder === "all" ||
                      (folder === "unfiled" && !m.folder_id) ||
                      (folder === "adornments" &&
                        handle.props.adornmentMedia.includes(m.id)) ||
                      m.folder_id === folder) &&
                    (filter === "all" ||
                      (filter === "missing-alt" && !m.alt) ||
                      m.mime_type.startsWith(filter)),
                )
                .map((m) => (
                  <button
                    type="button"
                    className={
                      "media-tile" + (selected?.id === m.id ? " selected" : "")
                    }
                    mix={on("click", () => {
                      selected = { ...m };
                      error = "";
                      handle.update();
                    })}
                  >
                    {m.mime_type.startsWith("image/") ? (
                      <img
                        src={"/tea/api/media/file/" + m.id}
                        alt={m.alt ?? m.filename}
                        loading="lazy"
                      />
                    ) : (
                      <div className="file-preview">
                        {m.mime_type.split("/")[1].toUpperCase()}
                      </div>
                    )}
                    <span>
                      <strong>{m.filename}</strong>
                      <small>
                        {(m.size / 1024).toFixed(0)} KB
                        {!m.alt ? " · No alt text" : ""}
                      </small>
                    </span>
                  </button>
                ))}
            </div>
          </div>
          <aside className="media-inspector" inert={savingDetails}>
            {selected ? (
              <>
                <div className="section-heading">
                  <h2>File details</h2>
                  <button
                    className="text-button"
                    mix={on("click", () => {
                      selected = null;
                      handle.update();
                    })}
                  >
                    Close
                  </button>
                </div>
                {selected.mime_type.startsWith("image/") && (
                  <img
                    className="inspector-image"
                    src={"/tea/api/media/file/" + selected.id}
                    alt={selected.alt ?? ""}
                  />
                )}
                <strong className="break-word">{selected.filename}</strong>
                <p className="muted">
                  {selected.mime_type} · {(selected.size / 1024).toFixed(1)} KB
                </p>
                <label>
                  Alternative text
                  <textarea
                    rows={4}
                    value={selected.alt ?? ""}
                    mix={on("input", (e) => {
                      selected!.alt = e.currentTarget.value;
                      handle.update();
                    })}
                  />
                </label>
                <label>
                  Notes
                  <textarea
                    rows={2}
                    maxLength={2000}
                    value={selected.description ?? ""}
                    mix={on("input", (e) => {
                      selected!.description = e.currentTarget.value;
                      handle.update();
                    })}
                  />
                  <small>Library notes; not shown on the website.</small>
                </label>
                <label>
                  Folder
                  <select
                    value={selected.folder_id ?? ""}
                    mix={on<HTMLSelectElement>("change", (e) => {
                      selected!.folder_id = e.currentTarget.value || null;
                      handle.update();
                    })}
                  >
                    <option value="" selected={!selected.folder_id}>
                      Unfiled
                    </option>
                    {folders.map((f) => (
                      <option
                        value={f.id}
                        selected={selected!.folder_id === f.id}
                      >
                        {folderPath(folders, f.id)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button primary"
                  disabled={savingDetails}
                  mix={on("click", () => void saveDetails())}
                >
                  Save details
                </button>
                <a href={"/tea/api/media/file/" + selected.id} target="_blank">
                  Open original ↗
                </a>
                <h3>Used on</h3>
                <p className="muted">
                  {handle.props.references[selected.id]?.join(", ") ||
                    "Not used."}
                </p>
                <button
                  className="button danger"
                  disabled={!!handle.props.references[selected.id]?.length}
                  mix={on("click", async () => {
                    const item = selected;
                    if (
                      !item ||
                      !confirm("Remove this file from the media library?")
                    )
                      return;
                    try {
                      const r = await fetch(
                        "/tea/admin/media/" + item.id + "/delete",
                        { method: "POST" },
                      );
                      if (!r.ok) throw new Error((await r.json()).error);
                      files = files.filter((f) => f.id !== item.id);
                      if (selected?.id === item.id) selected = null;
                      status = "Removed from the library.";
                    } catch (cause) {
                      error =
                        cause instanceof Error
                          ? cause.message
                          : "Could not remove the file.";
                    }
                    handle.update();
                  })}
                >
                  Remove from library
                </button>
              </>
            ) : (
              <div className="inspector-empty">
                <h2>Select a file</h2>
                <p className="muted">
                  Edit alt text and check where it's used.
                </p>
                <p className="muted">
                  Drop a file here to upload. Maximum 25 MB.
                </p>
              </div>
            )}
          </aside>
        </div>
      </>
    );
  },
);
