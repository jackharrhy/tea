import { clientEntry, css, on, type Handle } from "remix/component";
import type {
  EditorGroupCommand,
  EditorGroupsPanelState,
} from "./editor-groups-bridge.ts";

export const EditorGroups = clientEntry(
  `${import.meta.url}#EditorGroups`,
  function EditorGroupsComponent(handle: Handle) {
    let state: EditorGroupsPanelState | null = null;
    let nameDraft = "Group";
    let previousGroupId: string | null | undefined;

    function run(command: EditorGroupCommand) {
      state?.run(command);
    }

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-groups-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-groups-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-groups-state",
        (event) => {
          state = (event as CustomEvent<EditorGroupsPanelState>).detail;
          const group = state.selectedGroup;
          if (
            group &&
            (previousGroupId !== group.id ||
              document.activeElement?.id !== "group-name")
          ) {
            nameDraft = group.name;
          }
          previousGroupId = group?.id ?? null;
          handle.update();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-groups-ready"));
    });

    return () => {
      const editing = state?.editing ?? false;
      const selected = state?.selectedGroup;
      const open = state?.openGroupId;
      return (
        <div mix={css({ display: "contents" })}>
          <details id="group-tools">
            <summary>Groups</summary>
            <div class="group-controls" role="group" aria-label="Groups">
              <label for="group-name">Name</label>
              <input
                id="group-name"
                type="text"
                value={nameDraft}
                autoComplete="off"
                spellCheck={false}
                disabled={!editing}
                mix={on<HTMLInputElement>("input", (event) => {
                  nameDraft = event.currentTarget.value;
                })}
              />
              <button
                id="group-selection"
                type="button"
                disabled={!editing || !state?.canGroupSelection}
                mix={on("click", () =>
                  run({ type: "create", name: nameDraft }),
                )}
              >
                Group selection
              </button>
              <button
                id="rename-group"
                type="button"
                disabled={!editing || !selected}
                mix={on("click", () =>
                  run({ type: "rename", name: nameDraft }),
                )}
              >
                Rename
              </button>
              <button
                id="open-group"
                type="button"
                disabled={!editing || !selected || selected.id === open}
                mix={on("click", () => run({ type: "open" }))}
              >
                Open group
              </button>
              <button
                id="close-group"
                type="button"
                disabled={!open}
                mix={on("click", () => run({ type: "close" }))}
              >
                Close group
              </button>
              <button
                id="linked-duplicate-group"
                type="button"
                disabled={!editing || !selected || selected.id === open}
                mix={on("click", () => run({ type: "linked" }))}
              >
                Linked duplicate
              </button>
              <button
                id="unlink-group"
                type="button"
                disabled={!editing || !selected?.linked}
                mix={on("click", () => run({ type: "unlink" }))}
              >
                Unlink
              </button>
              <button
                id="ungroup-selection"
                type="button"
                disabled={!editing || !selected}
                mix={on("click", () => run({ type: "ungroup" }))}
              >
                Ungroup
              </button>
            </div>
          </details>
        </div>
      );
    };
  },
);
