import { on, ref, type Handle, type RemixNode } from "remix/component";

const grip = 16,
  minimumEditor = 240,
  minimumPreview = 280;
export function ResizableWorkspace(
  handle: Handle<{
    editor: RemixNode;
    preview: RemixNode;
    showPreview: boolean;
  }>,
) {
  let element: HTMLDivElement,
    width = 0,
    ratio = 0.55,
    resizing = false,
    savedRatio = 0.55,
    collapsed = false;
  function leftWidth() {
    if (collapsed && handle.props.showPreview && width >= 640) return 48;
    return Math.max(
      minimumEditor,
      Math.min(width - minimumPreview - grip, (width - grip) * ratio),
    );
  }
  function remember() {
    try {
      localStorage.setItem("tea-editor-split", String(ratio));
    } catch {}
  }
  function resize(left: number) {
    if (width < 640) return;
    collapsed = false;
    ratio =
      Math.max(minimumEditor, Math.min(width - minimumPreview - grip, left)) /
      (width - grip);
    handle.update();
  }
  handle.queueTask(() => {
    try {
      const saved = Number(localStorage.getItem("tea-editor-split"));
      if (saved > 0 && saved < 1) ratio = saved;
    } catch {}
    handle.update();
  });
  return () => (
    <div
      className={"editor-split" + (resizing ? " resizing" : "")}
      mix={ref((node, signal) => {
        element = node;
        const observer = new ResizeObserver((entries) => {
          width = entries[0].contentRect.width;
          handle.update();
        });
        observer.observe(node);
        signal.addEventListener("abort", () => observer.disconnect());
      })}
    >
      <div
        className={
          "split-panels" + (!handle.props.showPreview ? " no-preview" : "")
        }
        style={{ "--editor-width": width ? leftWidth() + "px" : "55%" }}
      >
        <div
          className={
            "editor-pane" +
            (collapsed && handle.props.showPreview ? " editor-collapsed" : "")
          }
          id="editor-pane"
        >
          <button
            className="text-button editor-collapse"
            type="button"
            aria-expanded={!collapsed}
            mix={on("click", () => {
              collapsed = !collapsed;
              handle.update();
            })}
          >
            {collapsed ? "Edit" : "Collapse editor"}
          </button>
          <div
            className="editor-scroll"
            hidden={collapsed && handle.props.showPreview}
          >
            {handle.props.editor}
          </div>
        </div>
        {handle.props.showPreview && (
          <>
            <div
              role="separator"
              aria-label="Resize editor and preview"
              aria-orientation="vertical"
              aria-controls="editor-pane preview-pane"
              aria-valuemin={48}
              aria-valuemax={Math.max(
                minimumEditor,
                width - minimumPreview - grip,
              )}
              aria-valuenow={Math.round(leftWidth())}
              aria-valuetext={Math.round(leftWidth()) + " pixel editor"}
              tabIndex={0}
              className="workspace-resizer"
              mix={[
                on("pointerdown", (e) => {
                  if (e.button !== 0) return;
                  e.preventDefault();
                  savedRatio = ratio;
                  resizing = true;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  handle.update();
                }),
                on("pointermove", (e) => {
                  if (resizing)
                    resize(
                      e.clientX -
                        element.getBoundingClientRect().left -
                        grip / 2,
                    );
                }),
                on("pointerup", () => {
                  resizing = false;
                  remember();
                  handle.update();
                }),
                on("pointercancel", () => {
                  ratio = savedRatio;
                  resizing = false;
                  handle.update();
                }),
                on("keydown", (e) => {
                  if (
                    !["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                  )
                    return;
                  e.preventDefault();
                  resize(
                    e.key === "Home"
                      ? minimumEditor
                      : e.key === "End"
                        ? width
                        : leftWidth() +
                          (e.key === "ArrowLeft" ? -1 : 1) *
                            (e.shiftKey ? 100 : 20),
                  );
                  remember();
                }),
              ]}
            >
              <span />
            </div>
            <div className="preview-pane" id="preview-pane">
              <div className="preview-size-tools">
                <span className="muted">
                  {Math.max(
                    0,
                    Math.round(
                      width < 640 ? width : width - leftWidth() - grip,
                    ),
                  )}{" "}
                  px
                </span>
                <button
                  type="button"
                  className="button small"
                  disabled={width < 640}
                  mix={on("click", () => {
                    resize(width - 390 - grip);
                    remember();
                  })}
                >
                  Mobile
                </button>
                <button
                  type="button"
                  className="button small"
                  disabled={width < 640}
                  mix={on("click", () => {
                    resize(minimumEditor);
                    remember();
                  })}
                >
                  Wide
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={width < 640}
                  mix={on("click", () => {
                    ratio = 0.55;
                    remember();
                    handle.update();
                  })}
                >
                  Reset split
                </button>
              </div>
              {handle.props.preview}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
