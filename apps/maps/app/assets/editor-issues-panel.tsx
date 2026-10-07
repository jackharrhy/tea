import {
  deriveEditorLayers,
  EDITOR_ISSUE_TYPE_INFO,
  type EditorIssue,
  type EditorIssueType,
} from "@tea/maps-editor/core";
import { clientEntry, on, type Handle } from "remix/component";
import type {
  IssueBrowserOptions,
  IssueBrowserState,
} from "./editor-issues.ts";

export const EditorIssues = clientEntry(
  `${import.meta.url}#EditorIssues`,
  function EditorIssuesComponent(handle: Handle) {
    let options: IssueBrowserOptions | null = null;
    let resetRevision = -1;
    const enabledTypes = new Set<EditorIssueType>(
      EDITOR_ISSUE_TYPE_INFO.map(({ type }) => type),
    );
    const hiddenIds = new Set<string>();
    let showHidden = false;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-issues-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-issues-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-issues-state",
        (event) => {
          const state = (event as CustomEvent<IssueBrowserState>).detail;
          options = state.options;
          if (state.resetRevision !== resetRevision) {
            resetRevision = state.resetRevision;
            hiddenIds.clear();
          }
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-issues-ready"));
    });

    function reportError(cause: unknown) {
      options?.status(cause instanceof Error ? cause.message : String(cause));
    }

    function select(issue: EditorIssue, reveal: boolean) {
      if (!options) return;
      const session = options.session();
      try {
        if (reveal) {
          if (!options.canEdit() || !options.prepareEdit()) return;
          session.showAll();
          const brushIds = new Set(issue.brushIds);
          const entityIds = new Set(issue.entityIds);
          for (const layer of deriveEditorLayers(session.document)) {
            const containsIssue =
              (layer.entityId ? entityIds.has(layer.entityId) : false) ||
              layer.brushIds.some((id) => brushIds.has(id)) ||
              layer.pointEntityIds.some((id) => entityIds.has(id));
            if (layer.hidden && containsIssue)
              session.setLayerFlag(layer.id, "hidden", false);
          }
        }
        const selection = session.selectIssue(issue.id);
        if (!selection) {
          options.status(`${issue.message} · document-wide finding`);
          return;
        }
        if (reveal) options.renderer()?.focusSelection();
        options.status(`${reveal ? "Revealed" : "Selected"}: ${issue.message}`);
      } catch (cause) {
        reportError(cause);
      }
    }

    function fix(issue: EditorIssue) {
      if (!options?.canEdit() || !options.prepareEdit()) return;
      try {
        if (!options.session().fixIssue(issue.id))
          options.status("That issue changed before it could be fixed");
      } catch (cause) {
        reportError(cause);
      }
      handle.update();
    }

    return () => {
      const issues = options?.session().issues ?? [];
      const activeIds = new Set(issues.map(({ id }) => id));
      for (const id of hiddenIds) if (!activeIds.has(id)) hiddenIds.delete(id);
      const errors = issues.filter(
        ({ severity }) => severity === "error",
      ).length;
      const warnings = issues.length - errors;
      const visible = issues.filter(
        (issue) =>
          enabledTypes.has(issue.type) &&
          (showHidden || !hiddenIds.has(issue.id)),
      );
      const canEdit = options?.canEdit() ?? false;

      return (
        <details id="issue-browser">
          <summary id="issue-summary">
            Issues · {errors} errors · {warnings} warnings
            {hiddenIds.size ? ` · ${hiddenIds.size} hidden` : ""}
          </summary>
          <div class="issue-controls">
            <details>
              <summary>Filter types</summary>
              <div id="issue-filters">
                {EDITOR_ISSUE_TYPE_INFO.map(({ type, label }) => (
                  <label>
                    <input
                      type="checkbox"
                      checked={enabledTypes.has(type)}
                      mix={on<HTMLInputElement>("change", (event) => {
                        if (event.currentTarget.checked) enabledTypes.add(type);
                        else enabledTypes.delete(type);
                        handle.update();
                      })}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </details>
            <label for="show-hidden-issues">
              <input
                id="show-hidden-issues"
                type="checkbox"
                checked={showHidden}
                mix={on<HTMLInputElement>("change", (event) => {
                  showHidden = event.currentTarget.checked;
                  handle.update();
                })}
              />{" "}
              Show hidden
            </label>
          </div>
          <ul id="issue-list">
            {visible.length ? (
              visible.map((issue) => {
                const label =
                  EDITOR_ISSUE_TYPE_INFO.find(({ type }) => type === issue.type)
                    ?.label ?? issue.type;
                const count = issue.brushIds.length + issue.entityIds.length;
                return (
                  <li
                    key={issue.id}
                    class="issue-row"
                    data-issue-id={issue.id}
                    data-severity={issue.severity}
                  >
                    <p>{issue.message}</p>
                    <small>
                      {label} ·{" "}
                      {count ? `${count} affected objects` : "document"}
                    </small>
                    <div class="issue-actions">
                      <button
                        type="button"
                        mix={on("click", () => select(issue, false))}
                      >
                        Select
                      </button>
                      <button
                        type="button"
                        disabled={!canEdit}
                        mix={on("click", () => select(issue, true))}
                      >
                        Reveal
                      </button>
                      {issue.fix && (
                        <button
                          type="button"
                          disabled={!canEdit}
                          mix={on("click", () => fix(issue))}
                        >
                          {issue.fix.label}
                        </button>
                      )}
                      <button
                        type="button"
                        mix={on("click", () => {
                          if (hiddenIds.has(issue.id))
                            hiddenIds.delete(issue.id);
                          else hiddenIds.add(issue.id);
                          handle.update();
                        })}
                      >
                        {hiddenIds.has(issue.id) ? "Unhide" : "Hide"}
                      </button>
                    </div>
                  </li>
                );
              })
            ) : (
              <li>
                {issues.length
                  ? "No issues match these filters."
                  : "No map issues found."}
              </li>
            )}
          </ul>
        </details>
      );
    };
  },
);
