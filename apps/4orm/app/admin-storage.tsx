import type { Handle } from "remix/component";
import type { StorageHealth } from "./storage-health.ts";
import { humanBytes } from "./media-view.tsx";

export function AdminStorage() {
  return () => (
    <details class="panel">
      <summary>
        <h2>storage health</h2>
      </summary>
      <div id="orphan-results">
        <button
          hx-get="/admin/orphans"
          hx-target="#orphan-results"
          hx-swap="innerHTML"
          hx-indicator="#orphan-spinner"
        >
          scan for orphans
        </button>
        <span id="orphan-spinner" class="htmx-indicator muted">
          {" "}
          scanning...
        </span>
      </div>
    </details>
  );
}
function CleanupForm(
  handle: Handle<{ kind: "files" | "records"; count: number }>,
) {
  return () => {
    const { kind, count } = handle.props;
    const label = kind === "files" ? "file(s)" : "record(s)";
    return (
      <form
        method="post"
        action={`/admin/cleanup/${kind}`}
        class="inline fourm-space-md"
        hx-post={`/admin/cleanup/${kind}`}
        hx-target="#orphan-results"
        hx-swap="innerHTML"
        hx-confirm={`Delete ${count} orphaned ${label} from ${kind === "files" ? "disk" : "database"}?`}
      >
        <button type="submit">
          delete {count} orphaned {label}
        </button>
      </form>
    );
  };
}
export function StorageHealthView(handle: Handle<StorageHealth>) {
  return () => (
    <>
      <h3>orphaned files</h3>
      <p class="muted">files on disk with no database record</p>
      {handle.props.orphanedFiles.length ? (
        <table class="fourm-data-table">
          <thead>
            <tr>
              <th>path</th>
              <th class="fourm-text-right">size</th>
            </tr>
          </thead>
          <tbody>
            {handle.props.orphanedFiles.map((file) => (
              <tr>
                <td>
                  <code>{file.path}</code>
                </td>
                <td class="fourm-text-right">{humanBytes(file.size)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>none found.</p>
      )}
      {handle.props.orphanedFiles.length ? (
        <CleanupForm kind="files" count={handle.props.orphanedFiles.length} />
      ) : null}
      <h3>orphaned records</h3>
      <p class="muted">database records whose files are missing from disk</p>
      {handle.props.orphanedRecords.length ? (
        <ul>
          {handle.props.orphanedRecords.map((path) => (
            <li>
              <code>{path}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p>none found.</p>
      )}
      {handle.props.orphanedRecords.length ? (
        <CleanupForm
          kind="records"
          count={handle.props.orphanedRecords.length}
        />
      ) : null}
    </>
  );
}
