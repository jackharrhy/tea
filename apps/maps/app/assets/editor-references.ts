import { parseMapSource, type MapDocument } from "@tea/maps-editor/core";
import type {
  EditorReferenceScene,
  EditorSourceRenderer,
} from "@tea/maps-editor/render";

interface ReferenceOptions {
  readonly document: () => MapDocument;
  readonly renderer: () => EditorSourceRenderer | null;
  readonly status: (message: string) => void;
}

export function initEditorReferences(options: ReferenceOptions): {
  scenes: () => readonly EditorReferenceScene[];
} {
  const list = document.querySelector<HTMLElement>("#reference-list")!;
  const count = document.querySelector<HTMLElement>("#reference-count")!;
  const fileInput =
    document.querySelector<HTMLInputElement>("#reference-file")!;
  const clear = document.querySelector<HTMLButtonElement>("#clear-references")!;
  let scenes: readonly EditorReferenceScene[] = [];

  function update(next: readonly EditorReferenceScene[]) {
    scenes = next;
    options.renderer()?.setReferenceScenes(scenes);
    count.textContent = `${scenes.length} loaded`;
    clear.disabled = scenes.length === 0;
    list.replaceChildren(
      ...scenes.map((scene) => {
        const row = document.createElement("div");
        row.className = "reference-row";
        const heading = document.createElement("label");
        const visible = document.createElement("input");
        visible.type = "checkbox";
        visible.checked = scene.visible;
        visible.addEventListener("change", () =>
          change(scene.id, { visible: visible.checked }),
        );
        heading.append(visible, ` ${scene.label}`);
        row.append(heading);
        for (const [axis, label] of ["X", "Y", "Z"].entries()) {
          const field = document.createElement("label");
          field.textContent = `${label} offset `;
          const input = document.createElement("input");
          input.type = "number";
          input.step = "16";
          input.value = String(scene.offset[axis]);
          input.addEventListener("change", () => {
            const value = input.valueAsNumber;
            if (!Number.isFinite(value)) {
              input.value = String(scene.offset[axis]);
              return;
            }
            const offset: [number, number, number] = [...scene.offset];
            offset[axis] = value;
            change(scene.id, { offset });
          });
          field.append(input);
          row.append(field);
        }
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Remove";
        remove.addEventListener("click", () =>
          update(scenes.filter((candidate) => candidate.id !== scene.id)),
        );
        row.append(remove);
        return row;
      }),
    );
  }

  function change(id: string, value: Partial<EditorReferenceScene>) {
    update(
      scenes.map((scene) => (scene.id === id ? { ...scene, ...value } : scene)),
    );
  }

  function add(label: string, map: MapDocument) {
    update([
      ...scenes,
      {
        id: crypto.randomUUID(),
        label,
        document: map,
        offset: [(scenes.length + 1) * 384, 0, 0],
        visible: true,
      },
    ]);
    options.status(`Loaded reference ${label}`);
  }

  document
    .querySelector<HTMLButtonElement>("#load-reference")!
    .addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    try {
      add(file.name, parseMapSource(await file.text()).document);
    } catch (error) {
      options.status(error instanceof Error ? error.message : String(error));
    }
  });
  document
    .querySelector<HTMLButtonElement>("#snapshot-reference")!
    .addEventListener("click", () => {
      const map = options.document();
      add(`Document revision ${map.revision}`, map);
    });
  clear.addEventListener("click", () => {
    update([]);
    options.status("Cleared reference scenes");
  });
  update([]);
  return { scenes: () => scenes };
}
