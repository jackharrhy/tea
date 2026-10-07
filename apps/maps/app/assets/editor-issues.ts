import {
  deriveEditorLayers,
  EDITOR_ISSUE_TYPE_INFO,
  type EditorIssue,
  type EditorIssueType,
  type EditorSession,
} from "@tea/maps-editor/core";
import type { EditorSourceRenderer } from "@tea/maps-editor/render";

export interface IssueBrowserOptions {
  readonly root: HTMLDetailsElement;
  readonly session: () => EditorSession;
  readonly renderer: () => EditorSourceRenderer | null;
  readonly canEdit: () => boolean;
  readonly prepareEdit: () => boolean;
  readonly status: (message: string) => void;
}

function action(label: string, onClick: () => void, disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

export function createIssueBrowser(options: IssueBrowserOptions) {
  const summary = options.root.querySelector<HTMLElement>("#issue-summary")!;
  const list = options.root.querySelector<HTMLUListElement>("#issue-list")!;
  const filters = options.root.querySelector<HTMLElement>("#issue-filters")!;
  const showHidden = options.root.querySelector<HTMLInputElement>(
    "#show-hidden-issues",
  )!;
  const enabledTypes = new Set<EditorIssueType>(
    EDITOR_ISSUE_TYPE_INFO.map(({ type }) => type),
  );
  const hiddenIds = new Set<string>();

  const reportError = (error: unknown) => {
    options.status(error instanceof Error ? error.message : String(error));
  };

  const select = (issue: EditorIssue, reveal: boolean) => {
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
          if (layer.hidden && containsIssue) {
            session.setLayerFlag(layer.id, "hidden", false);
          }
        }
      }
      const selection = session.selectIssue(issue.id);
      if (!selection) {
        options.status(`${issue.message} · document-wide finding`);
        return;
      }
      if (reveal) options.renderer()?.focusSelection();
      options.status(`${reveal ? "Revealed" : "Selected"}: ${issue.message}`);
    } catch (error) {
      reportError(error);
    }
  };

  const refresh = () => {
    const issues = options.session().issues;
    const activeIds = new Set(issues.map(({ id }) => id));
    for (const id of hiddenIds) if (!activeIds.has(id)) hiddenIds.delete(id);
    const errors = issues.filter(({ severity }) => severity === "error").length;
    const warnings = issues.length - errors;
    summary.textContent = `Issues · ${errors} errors · ${warnings} warnings${hiddenIds.size ? ` · ${hiddenIds.size} hidden` : ""}`;
    const visible = issues.filter(
      (issue) =>
        enabledTypes.has(issue.type) &&
        (showHidden.checked || !hiddenIds.has(issue.id)),
    );
    list.replaceChildren();
    if (visible.length === 0) {
      const empty = document.createElement("li");
      empty.textContent = issues.length
        ? "No issues match these filters."
        : "No map issues found.";
      list.append(empty);
      return;
    }
    for (const issue of visible) {
      const row = document.createElement("li");
      row.className = "issue-row";
      row.dataset.issueId = issue.id;
      row.dataset.severity = issue.severity;
      const message = document.createElement("p");
      message.textContent = issue.message;
      const meta = document.createElement("small");
      const typeLabel =
        EDITOR_ISSUE_TYPE_INFO.find(({ type }) => type === issue.type)?.label ??
        issue.type;
      const count = issue.brushIds.length + issue.entityIds.length;
      meta.textContent = `${typeLabel} · ${count ? `${count} affected objects` : "document"}`;
      const actions = document.createElement("div");
      actions.className = "issue-actions";
      actions.append(
        action("Select", () => select(issue, false)),
        action("Reveal", () => select(issue, true), !options.canEdit()),
      );
      if (issue.fix) {
        actions.append(
          action(
            issue.fix.label,
            () => {
              if (!options.canEdit() || !options.prepareEdit()) return;
              try {
                if (!options.session().fixIssue(issue.id)) {
                  options.status("That issue changed before it could be fixed");
                }
              } catch (error) {
                reportError(error);
              }
              refresh();
            },
            !options.canEdit(),
          ),
        );
      }
      actions.append(
        action(hiddenIds.has(issue.id) ? "Unhide" : "Hide", () => {
          if (hiddenIds.has(issue.id)) hiddenIds.delete(issue.id);
          else hiddenIds.add(issue.id);
          refresh();
        }),
      );
      row.append(message, meta, actions);
      list.append(row);
    }
  };

  for (const { type, label: title } of EDITOR_ISSUE_TYPE_INFO) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) enabledTypes.add(type);
      else enabledTypes.delete(type);
      refresh();
    });
    label.append(checkbox, document.createTextNode(title));
    filters.append(label);
  }
  showHidden.addEventListener("change", refresh);

  return {
    refresh,
    reset() {
      hiddenIds.clear();
      refresh();
    },
  };
}
