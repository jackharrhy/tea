import type {
  EditorCameraChangeEvent,
  EditorSourceRenderer,
  EditorViewportCameraState,
  EditorViewportKind,
} from "@tea/maps-editor/render";
import { z } from "zod";

const KINDS = ["perspective", "xy", "xz", "yz"] as const;
const STORAGE_PREFIX = "tea.maps.editor.workspace.";
const DEFAULT_LAYOUT = { column: 0.5, row: 0.5, inspector: 320 };

const vector = z.tuple([
  z.number().finite(),
  z.number().finite(),
  z.number().finite(),
]);
const camera = z.strictObject({
  center: vector,
  position: vector,
  yaw: z.number().finite(),
  pitch: z.number().finite().min(-1.45).max(1.45),
  distance: z.number().finite().min(8).max(65_536),
  orthographicSpan: z.number().finite().min(32).max(32_768),
  fieldOfViewDegrees: z.number().finite().min(20).max(120),
  flySpeed: z.number().finite().min(32).max(4_096),
}) satisfies z.ZodType<EditorViewportCameraState>;
const record = z.strictObject({
  version: z.literal(1),
  documentKey: z.string().min(1).max(4_096),
  cameras: z.strictObject({
    perspective: camera,
    xy: camera,
    xz: camera,
    yz: camera,
  }),
  layout: z.strictObject({
    column: z.number().finite().min(0.3).max(0.76),
    row: z.number().finite().min(0.2).max(0.8),
    inspector: z.number().int().min(240).max(520),
  }),
  perspectiveOnly: z.boolean(),
  updatedAt: z.number().int().nonnegative(),
});
type WorkspaceRecord = z.infer<typeof record>;
type Layout = WorkspaceRecord["layout"];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function initEditorWorkspace(options: {
  readonly renderer: () => EditorSourceRenderer | null;
  readonly render: () => void;
}) {
  const workspace = document.querySelector<HTMLElement>(".editor-workspace")!;
  const viewports = document.querySelector<HTMLElement>(".viewports")!;
  const toggle =
    document.querySelector<HTMLButtonElement>("#perspective-only")!;
  const handles = [...document.querySelectorAll<HTMLElement>("[data-resize]")];
  const orthoFrames = KINDS.slice(1).map(
    (kind) =>
      document.querySelector<HTMLCanvasElement>(`#${kind}`)!.parentElement!,
  );
  let documentKey: string | null = null;
  let layout: Layout = { ...DEFAULT_LAYOUT };
  let perspectiveOnly = false;
  let cameras: Partial<Record<EditorViewportKind, EditorViewportCameraState>> =
    {};
  let saved: WorkspaceRecord | null = null;
  let ready = false;
  let applying = false;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function completeCameras() {
    const { perspective, xy, xz, yz } = cameras;
    return perspective && xy && xz && yz ? { perspective, xy, xz, yz } : null;
  }

  function flush() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!dirty || !documentKey) return;
    const complete = completeCameras();
    if (!complete) return;
    try {
      localStorage.setItem(
        `${STORAGE_PREFIX}${encodeURIComponent(documentKey)}`,
        JSON.stringify({
          version: 1,
          documentKey,
          cameras: complete,
          layout,
          perspectiveOnly,
          updatedAt: Date.now(),
        }),
      );
      dirty = false;
    } catch {}
  }

  function changed() {
    if (applying || !documentKey) return;
    dirty = true;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(flush, 300);
  }

  function applyLayout() {
    workspace.style.setProperty("--inspector-width", `${layout.inspector}px`);
    viewports.style.setProperty("--viewport-column", `${layout.column * 100}%`);
    viewports.style.setProperty("--viewport-top", `${layout.row * 100}%`);
    for (const handle of handles) {
      switch (handle.dataset.resize) {
        case "column":
          handle.setAttribute(
            "aria-valuenow",
            String(Math.round(layout.column * 100)),
          );
          break;
        case "row":
          handle.setAttribute(
            "aria-valuenow",
            String(Math.round(layout.row * 100)),
          );
          break;
        case "cross":
          handle.setAttribute(
            "aria-valuetext",
            `Column ${Math.round(layout.column * 100)}%, row ${Math.round(layout.row * 100)}%`,
          );
          break;
        case "inspector":
          handle.setAttribute("aria-valuenow", String(layout.inspector));
      }
    }
    options.render();
  }

  function applyPerspectiveOnly() {
    viewports.dataset.perspectiveOnly = String(perspectiveOnly);
    for (const frame of orthoFrames) frame.hidden = perspectiveOnly;
    for (const handle of handles) {
      if (handle.dataset.resize !== "inspector")
        handle.hidden = perspectiveOnly;
    }
    toggle.textContent = perspectiveOnly ? "Restore" : "Expand";
    toggle.setAttribute(
      "aria-label",
      perspectiveOnly ? "Restore four viewports" : "Show Perspective only",
    );
    toggle.setAttribute("aria-pressed", String(perspectiveOnly));
    options
      .renderer()
      ?.setRenderedViewports(perspectiveOnly ? ["perspective"] : KINDS);
    options.render();
  }

  function captureCameras(renderer: EditorSourceRenderer) {
    cameras = Object.fromEntries(
      KINDS.map((kind) => [kind, renderer.viewportCamera(kind)]),
    ) as Record<EditorViewportKind, EditorViewportCameraState>;
  }

  function switchDocument(key: string) {
    flush();
    documentKey = key;
    dirty = false;
    saved = null;
    try {
      const serialized = localStorage.getItem(
        `${STORAGE_PREFIX}${encodeURIComponent(key)}`,
      );
      if (serialized) {
        const parsed = record.safeParse(JSON.parse(serialized));
        if (parsed.success && parsed.data.documentKey === key)
          saved = parsed.data;
      }
    } catch {}
    layout = saved?.layout ?? { ...DEFAULT_LAYOUT };
    perspectiveOnly = saved?.perspectiveOnly ?? false;
    applying = true;
    applyLayout();
    applyPerspectiveOnly();
    if (ready) {
      const renderer = options.renderer();
      if (renderer) {
        if (saved) renderer.restoreViewportCameras(saved.cameras);
        captureCameras(renderer);
      }
    }
    applying = false;
    if (!saved) changed();
  }

  function resize(kind: string | undefined, x: number, y: number) {
    if (kind === "inspector") {
      const bounds = workspace.getBoundingClientRect();
      layout = {
        ...layout,
        inspector: Math.round(
          clamp(bounds.right - x, 240, Math.min(520, bounds.width * 0.48)),
        ),
      };
    } else {
      const bounds = viewports.getBoundingClientRect();
      layout = {
        ...layout,
        column:
          kind === "column" || kind === "cross"
            ? clamp((x - bounds.left) / bounds.width, 0.3, 0.76)
            : layout.column,
        row:
          kind === "row" || kind === "cross"
            ? clamp((y - bounds.top) / bounds.height, 0.2, 0.8)
            : layout.row,
      };
    }
    applyLayout();
    changed();
  }

  for (const handle of handles) {
    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      const move = (next: PointerEvent) =>
        resize(handle.dataset.resize, next.clientX, next.clientY);
      const finish = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", finish);
        handle.removeEventListener("pointercancel", finish);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("pointercancel", finish);
    });
    handle.addEventListener("keydown", (event) => {
      const horizontal =
        event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
      const vertical =
        event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0;
      if (!horizontal && !vertical) return;
      event.preventDefault();
      const kind = handle.dataset.resize;
      if (kind === "inspector")
        layout = {
          ...layout,
          inspector: Math.round(
            clamp(layout.inspector - horizontal * 10, 240, 520),
          ),
        };
      else
        layout = {
          ...layout,
          column:
            kind === "column" || kind === "cross"
              ? clamp(layout.column + horizontal * 0.02, 0.3, 0.76)
              : layout.column,
          row:
            kind === "row" || kind === "cross"
              ? clamp(layout.row + vertical * 0.02, 0.2, 0.8)
              : layout.row,
        };
      applyLayout();
      changed();
    });
  }
  toggle.addEventListener("click", () => {
    perspectiveOnly = !perspectiveOnly;
    applyPerspectiveOnly();
    changed();
  });
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  applyLayout();
  applyPerspectiveOnly();

  return {
    switchDocument,
    cameraChanged(event: EditorCameraChangeEvent) {
      if (!ready || applying) return;
      cameras = { ...cameras, [event.viewport]: event.camera };
      changed();
    },
    applyInitial(renderer: EditorSourceRenderer) {
      ready = true;
      toggle.disabled = false;
      applying = true;
      try {
        if (saved) renderer.restoreViewportCameras(saved.cameras);
        captureCameras(renderer);
        applyPerspectiveOnly();
      } finally {
        applying = false;
      }
      if (!saved) changed();
    },
    flush,
  };
}
