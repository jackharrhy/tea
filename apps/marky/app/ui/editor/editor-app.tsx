import { clientEntry, css, on, ref, type Handle } from "remix/component";

import { CollaborativeEditor } from "../../frontend/collaborative-editor.ts";
import {
  SocketHandler,
  type AwarenessClientState,
} from "../../frontend/socket-handler.ts";
import { getUser, type User } from "../../frontend/user.ts";
import { MARKDOWN_EXTENSION } from "../../shared/constants.ts";

export interface EditorAppProps {
  authMode:
    | { mode: "anonymous" }
    | { mode: "discord"; identity: { name: string; color: string } };
}

// `EditorApp` owns everything browser-side: the websocket, the editor view,
// the file list, awareness presence, and persistence. It server-renders an
// empty shell so the page paints fast, then hydrates here.
export const EditorApp = clientEntry(
  import.meta.url,
  function EditorApp(handle: Handle<EditorAppProps>) {
    // Setup runs on the server during SSR and again during hydration. Anything
    // that touches `window`, `localStorage`, or opens a websocket has to wait
    // until we know we are in the browser.
    const isBrowser = typeof window !== "undefined";

    // In discord mode the identity is available in props during SSR, so seed
    // it eagerly. Otherwise the SSR/hydration trees have different shapes
    // (no `<span>` badge during SSR, one after hydration) and the reconciler
    // can leave the SSR sign-out form orphaned alongside the new tree.
    const authModeProp = handle.props.authMode;
    let user: User | null =
      authModeProp.mode === "discord" ? authModeProp.identity : null;
    let socket: SocketHandler | null = null;
    let editor: CollaborativeEditor | null = null;
    let editorElement: HTMLElement | null = null;
    let newFileInput: HTMLInputElement | null = null;

    let files: string[] = [];
    let currentFilename: string | null = null;
    let editorMountedFor: string | null = null;
    let awarenessStates = new Map<number, AwarenessClientState>();
    let contextMenu: { filename: string; x: number; y: number } | null = null;
    let renamingFilename: string | null = null;
    let renameInput: HTMLInputElement | null = null;
    let toast: { text: string; expiresAt: number } | null = null;
    let toastTimer: ReturnType<typeof setTimeout> | null = null;

    function refresh(): void {
      handle.update().catch(() => {
        // Ignore update errors — they fire on the first hydration tick.
      });
    }

    function mountEditorIfReady(filename: string): void {
      if (!socket) return;
      const subdoc = socket.getSubdoc(filename);
      const awareness = socket.getSubdocAwareness(filename);
      if (!subdoc || !awareness) return;
      if (editorMountedFor === filename && editor) return;

      if (editor) {
        editor.switchToSubdoc(subdoc, awareness);
      } else {
        editor = new CollaborativeEditor({ subdoc, awareness });
      }
      editorMountedFor = filename;
      if (editorElement) editor.mount(editorElement);
    }

    function openFile(filename: string): void {
      if (!socket) return;
      currentFilename = filename;
      editorMountedFor = null;
      socket.setCurrentFile(filename);
      socket.openFile(filename);
      refresh();
    }

    function createFile(): void {
      const raw = newFileInput?.value.trim() ?? "";
      if (!raw || !socket) return;
      const filename = raw.endsWith(MARKDOWN_EXTENSION)
        ? raw
        : `${raw}${MARKDOWN_EXTENSION}`;
      if (newFileInput) newFileInput.value = "";
      openFile(filename);
    }

    function closeContextMenu(): void {
      if (contextMenu === null) return;
      contextMenu = null;
      refresh();
    }

    function openContextMenuFor(filename: string, x: number, y: number): void {
      contextMenu = { filename, x, y };
      refresh();
    }

    function showToast(text: string): void {
      toast = { text, expiresAt: Date.now() + 4000 };
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast = null;
        toastTimer = null;
        refresh();
      }, 4000);
      refresh();
    }

    function submitRename(oldName: string): void {
      if (!socket || !renameInput) return;
      const raw = renameInput.value.trim();
      if (!raw) {
        renamingFilename = null;
        refresh();
        return;
      }
      const newName = raw.endsWith(MARKDOWN_EXTENSION)
        ? raw
        : `${raw}${MARKDOWN_EXTENSION}`;
      if (newName === oldName) {
        renamingFilename = null;
        refresh();
        return;
      }
      socket.renameFile(oldName, newName);
      if (currentFilename === oldName) currentFilename = newName;
      renamingFilename = null;
      refresh();
    }

    if (isBrowser) {
      // Anonymous identity lives in localStorage, so it can only be resolved
      // in the browser. Discord identity was already seeded above.
      if (authModeProp.mode === "anonymous") user = getUser();
      socket = new SocketHandler({
        onFileListUpdate: (next) => {
          files = next;
          refresh();
        },
        onSubdocUpdate: (filename) => {
          if (filename === currentFilename) mountEditorIfReady(filename);
        },
        onAwarenessUpdate: () => {
          if (socket) awarenessStates = socket.getAllAwarenessStates();
          refresh();
        },
        onSubdocAwarenessUpdate: (filename) => {
          if (filename === currentFilename) mountEditorIfReady(filename);
          refresh();
        },
        onError: showToast,
      });
      if (user) socket.setUser(user);
      awarenessStates = socket.getAllAwarenessStates();

      handle.signal.addEventListener("abort", () => {
        editor?.destroy();
        socket?.close();
      });
    }

    if (isBrowser) {
      const onGlobalMouseDown = () => closeContextMenu();
      window.addEventListener("mousedown", onGlobalMouseDown);
      handle.signal.addEventListener("abort", () => {
        window.removeEventListener("mousedown", onGlobalMouseDown);
        if (toastTimer) clearTimeout(toastTimer);
      });
    }

    return () => (
      <div mix={layoutStyle}>
        <header mix={headerStyle}>
          <h1 mix={titleStyle}>tea/marky</h1>
          {user && (
            <span mix={userBadgeStyle} style={{ color: user.color }}>
              {user.name}
            </span>
          )}
          {handle.props.authMode.mode === "discord" && (
            <form method="post" action="/auth/sign-out" mix={signOutFormStyle}>
              <button type="submit" mix={signOutButtonStyle}>
                Sign out
              </button>
            </form>
          )}
        </header>

        <div mix={bodyStyle}>
          <aside mix={sidebarStyle}>
            <div mix={newFileFieldStyle}>
              <input
                type="text"
                placeholder="new-file-name"
                mix={[
                  inputStyle,
                  ref<HTMLInputElement>((node) => {
                    newFileInput = node;
                  }),
                  on("keydown", (event) => {
                    if ((event as KeyboardEvent).key === "Enter") createFile();
                  }),
                ]}
              />
              <button
                type="button"
                mix={[buttonStyle, on("click", createFile)]}
              >
                New
              </button>
            </div>
            <ul mix={fileListStyle}>
              {files.map((file) => {
                const display = file.replace(/\.md$/, "");
                const viewers = collectViewers(awarenessStates, file);
                const active = file === currentFilename;
                const isRenaming = renamingFilename === file;
                return (
                  <li
                    key={file}
                    mix={[
                      fileItemStyle,
                      on("click", () => {
                        if (!isRenaming) openFile(file);
                      }),
                      on("contextmenu", (event) => {
                        event.preventDefault();
                        openContextMenuFor(
                          file,
                          (event as MouseEvent).clientX,
                          (event as MouseEvent).clientY,
                        );
                      }),
                    ]}
                    style={{
                      background: active ? "var(--ui-2)" : undefined,
                      fontWeight: active ? 700 : undefined,
                    }}
                  >
                    {isRenaming ? (
                      <input
                        type="text"
                        defaultValue={display}
                        mix={[
                          renameInputStyle,
                          ref<HTMLInputElement>((node) => {
                            renameInput = node;
                            node.focus();
                            node.select();
                          }),
                          on("keydown", (event) => {
                            const key = (event as KeyboardEvent).key;
                            if (key === "Enter") {
                              event.preventDefault();
                              submitRename(file);
                            } else if (key === "Escape") {
                              event.preventDefault();
                              renamingFilename = null;
                              refresh();
                            }
                          }),
                          on("mousedown", (event) => event.stopPropagation()),
                          on("click", (event) => event.stopPropagation()),
                        ]}
                      />
                    ) : (
                      <span>{display}</span>
                    )}
                    {viewers.length > 0 && (
                      <span mix={dotsStyle}>
                        {viewers.map((viewer, idx) => (
                          <span
                            key={idx}
                            mix={dotStyle}
                            style={{ background: viewer.color }}
                            title={viewer.name}
                          />
                        ))}
                      </span>
                    )}
                  </li>
                );
              })}
              {files.length === 0 && (
                <li mix={emptyHintStyle}>No files yet. Create one above.</li>
              )}
            </ul>
          </aside>

          <section mix={mainStyle}>
            {currentFilename ? (
              <div mix={mainHeaderStyle}>
                <span>{currentFilename.replace(/\.md$/, "")}</span>
                <span mix={editorPresenceStyle}>
                  {socket
                    ? collectSubdocViewers(
                        socket.getSubdocAwarenessStates(currentFilename),
                      ).map((viewer, idx) => (
                        <span
                          key={idx}
                          mix={dotStyle}
                          style={{ background: viewer.color }}
                          title={viewer.name}
                        />
                      ))
                    : null}
                </span>
              </div>
            ) : (
              <div mix={mainHeaderStyle}>
                <span style={{ color: "var(--tx-2)" }}>
                  Open a file to start editing.
                </span>
              </div>
            )}
            <div
              data-testid="editor-mount"
              mix={[
                editorMountStyle,
                ref<HTMLDivElement>((node) => {
                  editorElement = node;
                  if (currentFilename) {
                    if (editor) editor.mount(node);
                    else mountEditorIfReady(currentFilename);
                  }
                }),
              ]}
            />
          </section>
        </div>

        {contextMenu && (
          <div
            mix={[
              contextMenuStyle,
              on("mousedown", (event) => event.stopPropagation()),
            ]}
            style={{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }}
          >
            <button
              type="button"
              mix={[
                contextMenuItemStyle,
                on("click", () => {
                  if (!contextMenu) return;
                  renamingFilename = contextMenu.filename;
                  closeContextMenu();
                }),
              ]}
            >
              Rename
            </button>
            <button
              type="button"
              mix={[
                contextMenuItemStyle,
                on("click", () => {
                  if (!contextMenu || !socket) return;
                  const target = contextMenu.filename;
                  closeContextMenu();
                  if (window.confirm(`Delete ${target}?`)) {
                    socket.deleteFile(target);
                    if (currentFilename === target) {
                      currentFilename = null;
                      editorMountedFor = null;
                    }
                    refresh();
                  }
                }),
              ]}
            >
              Delete
            </button>
          </div>
        )}

        {toast && <div mix={toastStyle}>{toast.text}</div>}
      </div>
    );
  },
);

function collectViewers(
  states: Map<number, AwarenessClientState>,
  filename: string,
): User[] {
  const out: User[] = [];
  for (const state of states.values()) {
    if (state.currentFile === filename && state.user) out.push(state.user);
  }
  return out;
}

function collectSubdocViewers(
  states: Map<number, AwarenessClientState>,
): User[] {
  const out: User[] = [];
  for (const state of states.values()) {
    if (state.user) out.push(state.user);
  }
  return out;
}

const layoutStyle = css({
  flex: 1,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
});

const headerStyle = css({
  display: "flex",
  alignItems: "center",
  gap: "12px",
  padding: "8px 16px",
  borderBottom: "1px solid var(--ui)",
  background: "var(--bg-2)",
});

const titleStyle = css({
  margin: 0,
  fontSize: "14px",
  fontWeight: 700,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
});

const userBadgeStyle = css({
  marginLeft: "auto",
  fontSize: "12px",
  fontWeight: 700,
});

const signOutFormStyle = css({
  margin: 0,
});

const signOutButtonStyle = css({
  font: "inherit",
  background: "transparent",
  border: "1px solid var(--ui-2)",
  color: "var(--tx-2)",
  padding: "4px 10px",
  borderRadius: "4px",
  cursor: "pointer",
  "&:hover": { color: "var(--tx)", borderColor: "var(--tx-3)" },
});

const bodyStyle = css({
  flex: 1,
  display: "flex",
  minHeight: 0,
});

const sidebarStyle = css({
  width: "260px",
  borderRight: "1px solid var(--ui)",
  background: "var(--bg-2)",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
});

const newFileFieldStyle = css({
  display: "flex",
  gap: "8px",
  padding: "12px",
  borderBottom: "1px solid var(--ui)",
});

const inputStyle = css({
  flex: 1,
  minWidth: 0,
  padding: "6px 8px",
  borderRadius: "4px",
  border: "1px solid var(--ui-2)",
  background: "var(--bg)",
  color: "var(--tx)",
  font: "inherit",
  "&:focus": { outline: "1px solid var(--tx-2)", outlineOffset: "0" },
});

const buttonStyle = css({
  padding: "6px 12px",
  borderRadius: "4px",
  border: "1px solid var(--ui-2)",
  background: "var(--bg)",
  color: "var(--tx)",
  font: "inherit",
  cursor: "pointer",
  "&:hover": { background: "var(--ui)" },
});

const fileListStyle = css({
  margin: 0,
  padding: "8px 0",
  listStyle: "none",
  overflowY: "auto",
  flex: 1,
});

const fileItemStyle = css({
  padding: "6px 16px",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "8px",
  "&:hover": { background: "var(--ui)" },
});

const emptyHintStyle = css({
  padding: "12px 16px",
  color: "var(--tx-2)",
  fontStyle: "italic",
});

const dotsStyle = css({
  display: "inline-flex",
  gap: "4px",
});

const dotStyle = css({
  width: "8px",
  height: "8px",
  borderRadius: "50%",
  display: "inline-block",
});

const mainStyle = css({
  flex: 1,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
});

const mainHeaderStyle = css({
  display: "flex",
  alignItems: "center",
  gap: "12px",
  padding: "8px 16px",
  borderBottom: "1px solid var(--ui)",
  background: "var(--bg-2)",
  "& > span:first-of-type": {
    fontWeight: 700,
  },
  "& > button": {
    marginLeft: "auto",
  },
});

const editorPresenceStyle = css({
  display: "inline-flex",
  gap: "4px",
});

const editorMountStyle = css({
  flex: 1,
  overflow: "auto",
  padding: "16px 24px",
  background: "var(--bg)",
});

const contextMenuStyle = css({
  position: "fixed",
  zIndex: 100,
  background: "var(--bg, #fffcf0)",
  border: "1px solid #cecdc3",
  borderRadius: "6px",
  boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
  padding: "4px",
  display: "flex",
  flexDirection: "column",
  minWidth: "140px",
});

const contextMenuItemStyle = css({
  padding: "6px 12px",
  background: "transparent",
  border: "none",
  textAlign: "left",
  cursor: "pointer",
  font: "inherit",
  borderRadius: "4px",
  "&:hover": { background: "#f2f0e5" },
});

const renameInputStyle = css({
  padding: "2px 4px",
  border: "1px solid #205ea6",
  borderRadius: "3px",
  font: "inherit",
  width: "100%",
  boxSizing: "border-box",
});

const toastStyle = css({
  position: "fixed",
  right: "16px",
  bottom: "16px",
  zIndex: 200,
  padding: "10px 14px",
  background: "#af3029",
  color: "#fffcf0",
  borderRadius: "6px",
  boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
  maxWidth: "320px",
  fontSize: "13px",
});
