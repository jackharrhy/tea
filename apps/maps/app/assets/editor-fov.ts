import type { EditorSourceRenderer } from "@tea/maps-editor/render";

const STORAGE_KEY = "tea.maps.editor.default-fov";
const FACTORY_FOV = 60;

function validFov(value: number): boolean {
  return Number.isFinite(value) && value >= 20 && value <= 120;
}

export interface EditorFovContext {
  readonly currentFov: number;
  readonly defaultFov: number;
  readonly compiled: boolean;
  readonly set: (value: number) => void;
  readonly reset: () => void;
  readonly save: () => void;
  readonly factory: () => void;
}

export function initEditorFov(options: {
  readonly renderer: () => EditorSourceRenderer | null;
  readonly status: (message: string) => void;
}) {
  let defaultFov = FACTORY_FOV;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null && validFov(Number(stored)))
      defaultFov = Number(stored);
  } catch {}
  let currentFov = defaultFov;
  let rendererReady = false;
  let compiled = false;
  let componentReady = false;

  function publish() {
    if (!componentReady) return;
    window.dispatchEvent(
      new CustomEvent<EditorFovContext>("tea-maps-fov-state", {
        detail: {
          currentFov,
          defaultFov,
          compiled,
          set,
          reset: () => set(defaultFov),
          save: () => saveDefault(currentFov),
          factory: () => {
            saveDefault(FACTORY_FOV);
            set(FACTORY_FOV);
          },
        },
      }),
    );
  }

  function set(value: number) {
    if (!validFov(value)) {
      options.status("FOV must be between 20° and 120°");
      publish();
      return;
    }
    currentFov = value;
    options.renderer()?.setPerspectiveFieldOfView(value);
    publish();
  }

  function saveDefault(value: number) {
    defaultFov = value;
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      options.status(
        "FOV default applies for this session; browser storage is unavailable",
      );
    }
    publish();
  }

  window.addEventListener("tea-maps-fov-ready", () => {
    componentReady = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-fov-bridge-ready"));

  return {
    applyInitial(renderer: EditorSourceRenderer) {
      rendererReady = true;
      renderer.setPerspectiveFieldOfView(currentFov);
      publish();
    },
    cameraChanged(value: number) {
      if (!rendererReady || !validFov(value) || value === currentFov) return;
      currentFov = value;
      publish();
    },
    setCompiled(value: boolean) {
      compiled = value;
      publish();
    },
  };
}
