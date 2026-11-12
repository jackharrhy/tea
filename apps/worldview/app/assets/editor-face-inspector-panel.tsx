import { clientEntry, type Handle } from "remix/component";
import { EditorFaceBasics } from "./editor-face-basics-panel.tsx";
import {
  EditorFaceProjectionFields,
  EditorTextureAlignment,
} from "./editor-face-texture-panel.tsx";
import { EditorSurface } from "./editor-surface-panel.tsx";
import { EditorUvControls } from "./editor-uv-controls-panel.tsx";

interface Visibility {
  readonly visible: boolean;
  readonly projectionVisible: boolean;
}

export const EditorFaceInspector = clientEntry(
  `file:///app/assets/editor-face-inspector-panel.tsx#EditorFaceInspector`,
  function EditorFaceInspectorComponent(handle: Handle) {
    let visible = false;
    let projectionVisible = false;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-face-inspector-visibility",
        (event) => {
          const next = (event as CustomEvent<Visibility>).detail;
          visible = next.visible;
          projectionVisible = next.projectionVisible;
          handle.update();
        },
        { signal: handle.signal },
      );
      visible =
        document.documentElement.dataset.faceInspectorVisible === "true";
      projectionVisible =
        document.documentElement.dataset.faceProjectionVisible === "true";
      handle.update();
    });

    return () => (
      <div id="face-inspector" hidden={!visible}>
        <h2>Brush and face</h2>
        <EditorFaceBasics />
        <div id="face-projection" hidden={!projectionVisible}>
          <h3>Face projection</h3>
          <EditorFaceProjectionFields />
          <div class="uv-editor-frame">
            <svg
              id="uv-editor"
              viewBox="0 0 320 220"
              role="application"
              aria-label="Selected face UV editor"
              tabIndex={0}
            />
            <EditorUvControls />
          </div>
        </div>
        <EditorTextureAlignment />
        <EditorSurface />
      </div>
    );
  },
);
