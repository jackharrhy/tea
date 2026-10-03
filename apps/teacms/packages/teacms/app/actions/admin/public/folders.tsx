import { folderPath } from "../../../ui/public/folder-path.ts";
export { folderPath } from "../../../ui/public/folder-path.ts";
import { on, ref, type Handle, type RemixNode } from "remix/component";
import type { MediaFolder } from "../../../ui/public/content-types.ts";

export function Folders(
  handle: Handle<{
    folders: MediaFolder[];
    selected: string;
    select: (id: string) => void;
    change: (folders: MediaFolder[]) => void;
  }>,
) {
  let editing: MediaFolder | null = null,
    error = "",
    busy = false;
  function tree(parent: string | null, depth = 0): RemixNode {
    return handle.props.folders
      .filter((f) => f.parent_id === parent)
      .map((f) => (
        <div>
          <button
            type="button"
            className={
              "folder-link" + (handle.props.selected === f.id ? " active" : "")
            }
            style={{ paddingLeft: 10 + depth * 14 }}
            mix={on("click", () => handle.props.select(f.id))}
          >
            ▱ {f.name}
          </button>
          {tree(f.id, depth + 1)}
        </div>
      ));
  }
  return () => (
    <nav className="folder-nav" aria-label="Media folders">
      <h2>Library</h2>
      {[
        ["all", "All files"],
        ["unfiled", "Unfiled"],
        ["adornments", "Adornment artwork"],
      ].map(([id, label]) => (
        <button
          type="button"
          className={
            "folder-link" + (handle.props.selected === id ? " active" : "")
          }
          mix={on("click", () => handle.props.select(id))}
        >
          {label}
        </button>
      ))}
      <div className="section-heading">
        <h3>Folders</h3>
        <button
          type="button"
          className="text-button"
          mix={on("click", () => {
            editing = {
              id: "",
              name: "",
              description: "",
              parent_id: handle.props.folders.some(
                (f) => f.id === handle.props.selected,
              )
                ? handle.props.selected
                : null,
            };
            error = "";
            handle.update();
          })}
        >
          New folder
        </button>
      </div>
      {tree(null)}
      {handle.props.folders.some((f) => f.id === handle.props.selected) && (
        <button
          type="button"
          className="text-button"
          mix={on("click", () => {
            editing = {
              ...handle.props.folders.find(
                (f) => f.id === handle.props.selected,
              )!,
            };
            error = "";
            handle.update();
          })}
        >
          Edit folder
        </button>
      )}
      {editing && (
        <dialog
          className="folder-dialog"
          aria-label={editing.id ? "Edit folder" : "New folder"}
          mix={[
            ref((node) => node.showModal()),
            on("cancel", (e) => {
              e.preventDefault();
              if (!busy) {
                editing = null;
                handle.update();
              }
            }),
          ]}
        >
          <form
            inert={busy}
            mix={on("submit", async (event) => {
              event.preventDefault();
              busy = true;
              error = "";
              handle.update();
              try {
                const response = await fetch("/tea/admin/folders", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(editing),
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error);
                handle.props.change(result.folders);
                handle.props.select(result.id);
                editing = null;
              } catch (e) {
                error = (e as Error).message;
              } finally {
                busy = false;
                handle.update();
              }
            })}
          >
            <h2>{editing.id ? "Edit folder" : "New folder"}</h2>
            {error && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
            <label>
              Folder name
              <input
                required
                maxLength={100}
                value={editing.name}
                mix={on("input", (e) => {
                  editing!.name = e.currentTarget.value;
                  handle.update();
                })}
              />
            </label>
            <label>
              Description
              <textarea
                rows={3}
                maxLength={2000}
                value={editing.description}
                mix={on("input", (e) => {
                  editing!.description = e.currentTarget.value;
                  handle.update();
                })}
              />
            </label>
            <label>
              Inside
              <select
                value={editing.parent_id ?? ""}
                mix={on<HTMLSelectElement>("change", (e) => {
                  editing!.parent_id = e.currentTarget.value || null;
                  handle.update();
                })}
              >
                <option value="" selected={!editing.parent_id}>
                  Library
                </option>
                {handle.props.folders
                  .filter((f) => f.id !== editing!.id)
                  .map((f) => (
                    <option value={f.id} selected={editing!.parent_id === f.id}>
                      {folderPath(handle.props.folders, f.id)}
                    </option>
                  ))}
              </select>
            </label>
            <div className="form-actions">
              <button className="button primary" disabled={busy}>
                Save folder
              </button>
              <button
                type="button"
                className="button"
                disabled={busy}
                mix={on("click", () => {
                  editing = null;
                  handle.update();
                })}
              >
                Cancel
              </button>
              {editing.id && (
                <button
                  type="button"
                  className="text-button danger"
                  disabled={busy}
                  mix={on("click", async () => {
                    if (!confirm("Remove this empty folder?")) return;
                    busy = true;
                    handle.update();
                    try {
                      const response = await fetch(
                        "/tea/admin/folders/" + editing!.id + "/delete",
                        { method: "POST" },
                      );
                      const result = await response.json();
                      if (!response.ok) throw new Error(result.error);
                      handle.props.change(result.folders);
                      handle.props.select("all");
                      editing = null;
                    } catch (e) {
                      error = (e as Error).message;
                    } finally {
                      busy = false;
                      handle.update();
                    }
                  })}
                >
                  Remove folder
                </button>
              )}
            </div>
          </form>
        </dialog>
      )}
    </nav>
  );
}
