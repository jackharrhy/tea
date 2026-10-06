import { on, ref, type Handle } from "remix/component";
import morphdom from "morphdom/dist/morphdom-esm.js";
import { routes } from "../../../routes.ts";
import type { Page } from "../../../ui/public/content-types.ts";

export interface PreviewLayout {
  width: number;
  fontSize: number;
}

// The server remains the only renderer. Keep one sandboxed document alive and
// reconcile its body; unchanged images, embeds, scroll and details retain state.
export function LivePreview(
  handle: Handle<{
    page: Page;
    measure: (layout: PreviewLayout) => void;
  }>,
) {
  let frame: HTMLIFrameElement | undefined,
    error = "",
    previous = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  let initialized = false;

  function measure() {
    const doc = frame?.contentDocument,
      win = frame?.contentWindow;
    const article = doc?.querySelector<HTMLElement>("article.prose");
    if (!article || !win) return;
    const menu = doc?.querySelector<HTMLDetailsElement>(".site-menu");
    if (menu && menu.dataset.previewWide !== String(win.innerWidth >= 1024)) {
      menu.open = win.innerWidth >= 1024;
      menu.dataset.previewWide = String(menu.open);
    }
    if (article.clientWidth)
      handle.props.measure({
        width: article.clientWidth,
        fontSize: parseFloat(win.getComputedStyle(article).fontSize),
      });
  }
  async function update() {
    if (!frame) return;
    request?.abort();
    const current = (request = new AbortController());
    try {
      const response = await fetch(routes.admin.preview.href(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(handle.props.page),
        signal: current.signal,
      });
      if (!response.ok || response.redirected)
        throw new Error(
          "Preview unavailable. Check the title or sign in again.",
        );
      const html = await response.text();
      if (current.signal.aborted) return;
      if (!initialized) {
        await new Promise<void>((resolve, reject) => {
          current.signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
          frame!.addEventListener(
            "load",
            () => {
              initialized = true;
              resolve();
            },
            { once: true, signal: current.signal },
          );
          frame!.srcdoc = html;
        });
      } else {
        const next = new DOMParser().parseFromString(html, "text/html");
        const doc = frame.contentDocument!;
        const scroll = frame.contentWindow!.scrollY;
        morphdom(doc.body, next.body, {
          getNodeKey(node) {
            return node.nodeType === 1
              ? (node as Element).getAttribute("data-preview-key") ||
                  (node as Element).id
              : undefined;
          },
          onBeforeElUpdated(from, to) {
            if (from.matches("details.site-menu")) {
              to.toggleAttribute("open", from.hasAttribute("open"));
              to.dataset.previewWide = from.dataset.previewWide;
            }
            return !from.isEqualNode(to);
          },
        });
        morphdom(doc.head, next.head, {
          onBeforeElUpdated: (from, to) => !from.isEqualNode(to),
        });
        frame.contentWindow!.scrollTo(0, scroll);
      }
      error = "";
      measure();
      handle.update();
    } catch (cause) {
      if (!current.signal.aborted) {
        error = cause instanceof Error ? cause.message : "Preview unavailable.";
        handle.update();
      }
    }
  }
  handle.signal.addEventListener("abort", () => {
    clearTimeout(timer);
    request?.abort();
  });
  return () => {
    const snapshot = JSON.stringify(handle.props.page);
    if (snapshot !== previous) {
      previous = snapshot;
      handle.queueTask(() => {
        clearTimeout(timer);
        request?.abort();
        timer = setTimeout(() => void update(), 200);
      });
    }
    return (
      <aside className="preview-panel">
        <div className="preview-feedback">
          {error && <p role="alert">{error}</p>}
          <button
            type="button"
            className="text-button"
            mix={on("click", () => void update())}
          >
            Refresh preview ↻
          </button>
        </div>
        <iframe
          title="Page preview"
          sandbox="allow-same-origin"
          mix={ref((node, signal) => {
            frame = node;
            const observer = new ResizeObserver(measure);
            observer.observe(node);
            node.addEventListener("load", measure, { signal });
            signal.addEventListener("abort", () => {
              observer.disconnect();
              frame = undefined;
            });
          })}
        />
      </aside>
    );
  };
}
