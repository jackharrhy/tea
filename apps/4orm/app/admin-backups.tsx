import type { Handle } from "remix/component";
import type { Community } from "./data/community.ts";
import { humanBytes } from "./media-view.tsx";
export type BackupStatus = ReturnType<Community["backupStatus"]>;
export function BackupList(handle: Handle<BackupStatus>) {
  return () => {
    const { backups, last, pending } = handle.props;
    return (
      <>
        {pending ? (
          <p class="muted">backup in progress: {String(pending.name)}</p>
        ) : null}
        {last?.error ? (
          <p class="error">last backup error: {String(last.error)}</p>
        ) : last ? (
          <p class="ok">
            last backup: {String(last.name)} (db=true, files=
            {String(last.file_count)})
          </p>
        ) : null}
        {backups.length ? (
          <table class="forum-table">
            <thead>
              <tr>
                <th>snapshot</th>
                <th class="fourm-text-right">db size</th>
                <th class="fourm-text-right">files</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((backup) => (
                <tr>
                  <td>{String(backup.name)}</td>
                  <td class="fourm-text-right">
                    {humanBytes(Number(backup.db_size))}
                  </td>
                  <td class="fourm-text-right">{String(backup.file_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p>no backups yet.</p>
        )}
      </>
    );
  };
}
export function AdminBackups(handle: Handle<BackupStatus>) {
  return () => {
    const { backups, last } = handle.props;
    return (
      <details class="panel">
        <summary>
          <h2>backups</h2>
        </summary>
        <p>
          <strong>{backups.length}</strong> snapshots ·{" "}
          <strong>
            {humanBytes(
              backups.reduce((sum, backup) => sum + Number(backup.db_size), 0),
            )}
          </strong>{" "}
          total
          {backups[0] ? (
            <>
              {" "}
              · latest: <code>{String(backups[0].name)}</code>
            </>
          ) : null}
          {last?.error ? (
            <>
              {" "}
              · <span class="error">last error: {String(last.error)}</span>
            </>
          ) : last ? (
            <> · last run: {String(last.name)}</>
          ) : null}
        </p>
        <div id="backup-results">
          <button
            hx-get="/admin/backups"
            hx-target="#backup-results"
            hx-swap="innerHTML"
          >
            view full backup list
          </button>
        </div>
        <form
          method="post"
          action="/admin/backups/run"
          class="inline fourm-space-sm"
          hx-post="/admin/backups/run"
          hx-target="#backup-status"
          hx-swap="innerHTML"
        >
          <button type="submit">run backup now</button>
        </form>
        <span id="backup-status"></span>
      </details>
    );
  };
}
