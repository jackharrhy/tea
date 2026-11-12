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
    </>
  );
}
