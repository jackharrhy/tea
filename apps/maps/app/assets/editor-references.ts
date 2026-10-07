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

export interface EditorReferencesContext {
  readonly scenes: readonly EditorReferenceScene[];
  readonly loadFile: (file: File) => Promise<void>;
  readonly snapshot: () => void;
  readonly clear: () => void;
  readonly change: (id: string, value: Partial<EditorReferenceScene>) => void;
  readonly remove: (id: string) => void;
}

export function initEditorReferences(options: ReferenceOptions): {
  scenes: () => readonly EditorReferenceScene[];
} {
  let scenes: readonly EditorReferenceScene[] = [];
  let ready = false;

  function publish() {
    if (!ready) return;
    window.dispatchEvent(
      new CustomEvent<EditorReferencesContext>("tea-maps-references-state", {
        detail: { scenes, loadFile, snapshot, clear, change, remove },
      }),
    );
  }

  function update(next: readonly EditorReferenceScene[]) {
    scenes = next;
    options.renderer()?.setReferenceScenes(scenes);
    publish();
  }

  function change(id: string, value: Partial<EditorReferenceScene>) {
    update(
      scenes.map((scene) => (scene.id === id ? { ...scene, ...value } : scene)),
    );
  }

  function remove(id: string) {
    update(scenes.filter((scene) => scene.id !== id));
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

  async function loadFile(file: File) {
    try {
      add(file.name, parseMapSource(await file.text()).document);
    } catch (cause) {
      options.status(cause instanceof Error ? cause.message : String(cause));
    }
  }

  function snapshot() {
    const map = options.document();
    add(`Document revision ${map.revision}`, map);
  }

  function clear() {
    update([]);
    options.status("Cleared reference scenes");
  }

  window.addEventListener("tea-maps-references-ready", () => {
    ready = true;
    publish();
  });
  window.dispatchEvent(new Event("tea-maps-references-bridge-ready"));

  return { scenes: () => scenes };
}
