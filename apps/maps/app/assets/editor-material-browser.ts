import type { EditorMaterial, EditorSession } from "@tea/maps-editor/core";

export interface MaterialBrowserContext {
  readonly session: () => EditorSession;
  readonly prepare: () => boolean;
  readonly activate: (name: string) => void;
  readonly tool: (tool: "select" | "face") => void;
  readonly status: (message: string) => void;
  readonly materials: readonly EditorMaterial[];
  readonly current: string;
  readonly revision: number;
}

export function initEditorMaterialBrowser(
  options: Omit<MaterialBrowserContext, "materials" | "current" | "revision">,
) {
  let materials: readonly EditorMaterial[] = [];
  let current = "DEV_FLOOR";
  let revision = 0;
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<MaterialBrowserContext>(
        "tea-maps-material-browser-state",
        {
          detail: {
            ...options,
            activate(name) {
              current = name;
              options.activate(name);
            },
            materials,
            current,
            revision,
          },
        },
      ),
    );
  }

  window.addEventListener("tea-maps-material-browser-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-material-browser-bridge-ready"));

  return {
    setMaterials(next: readonly EditorMaterial[]) {
      materials = next;
      revision++;
      if (
        materials.length > 0 &&
        !materials.some(
          (material) => material.name.toLowerCase() === current.toLowerCase(),
        )
      ) {
        current =
          materials.find((material) => material.name === "DEV_FLOOR")?.name ??
          materials[0]!.name;
      }
      options.activate(current);
      publish();
    },
    refresh: publish,
    setCurrent(name: string) {
      current = name;
      options.activate(name);
      publish();
    },
  };
}
