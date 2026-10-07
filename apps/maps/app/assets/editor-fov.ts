import type { EditorSourceRenderer } from "@tea/maps-editor/render";

const STORAGE_KEY = "tea.maps.editor.default-fov";
const FACTORY_FOV = 60;

function validFov(value: number): boolean {
  return Number.isFinite(value) && value >= 20 && value <= 120;
}

export function initEditorFov(options: {
  readonly renderer: () => EditorSourceRenderer | null;
  readonly status: (message: string) => void;
}) {
  const details = document.querySelector<HTMLDetailsElement>("#editor-fov")!;
  const trigger = document.querySelector<HTMLElement>("#editor-fov-trigger")!;
  const input = document.querySelector<HTMLInputElement>("#editor-fov-value")!;
  const defaultLabel = document.querySelector<HTMLElement>(
    "#editor-fov-default",
  )!;
  const reset = document.querySelector<HTMLButtonElement>("#editor-fov-reset")!;
  const save = document.querySelector<HTMLButtonElement>("#editor-fov-save")!;
  const factory = document.querySelector<HTMLButtonElement>(
    "#editor-fov-factory",
  )!;
  let defaultFov = FACTORY_FOV;
  let ready = false;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null && validFov(Number(stored)))
      defaultFov = Number(stored);
  } catch {}
  let currentFov = defaultFov;

  function render() {
    trigger.textContent = `FOV ${Math.round(currentFov)}°${Math.abs(currentFov - defaultFov) > 0.01 ? " *" : ""}`;
    input.value = String(currentFov);
    defaultLabel.textContent = `Default: ${Math.round(defaultFov)}°`;
    reset.disabled = Math.abs(currentFov - defaultFov) <= 0.01;
    save.disabled = reset.disabled;
  }

  function set(value: number) {
    if (!validFov(value)) {
      input.value = String(currentFov);
      options.status("FOV must be between 20° and 120°");
      return;
    }
    currentFov = value;
    options.renderer()?.setPerspectiveFieldOfView(value);
    render();
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
    render();
  }

  input.addEventListener("change", () => set(input.valueAsNumber));
  reset.addEventListener("click", () => set(defaultFov));
  save.addEventListener("click", () => saveDefault(currentFov));
  factory.addEventListener("click", () => {
    saveDefault(FACTORY_FOV);
    set(FACTORY_FOV);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!details.contains(event.target as Node)) details.open = false;
  });
  render();

  return {
    applyInitial(renderer: EditorSourceRenderer) {
      ready = true;
      renderer.setPerspectiveFieldOfView(currentFov);
    },
    cameraChanged(value: number) {
      if (!ready || !validFov(value) || value === currentFov) return;
      currentFov = value;
      render();
    },
    setCompiled(compiled: boolean) {
      details.toggleAttribute("inert", compiled);
      if (compiled) details.open = false;
    },
  };
}
