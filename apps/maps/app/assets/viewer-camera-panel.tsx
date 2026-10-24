import type { CameraState } from "@jackharrhy/tea-maps-renderer";
import type { MapsViewElement } from "@jackharrhy/tea-maps-renderer/element";
import { clientEntry, on, type Handle } from "remix/component";
import { cameraUrlValue } from "./remote-input.ts";

export const ViewerCameraPanel = clientEntry(
  `file:///app/assets/viewer-camera-panel.tsx#ViewerCameraPanel`,
  function ViewerCameraPanelComponent(handle: Handle) {
    let element: MapsViewElement | null = null;
    let reticle: HTMLElement | null = null;
    let startCamera: CameraState | null = null;
    let ready = false;
    let showReticle = true;
    let movementMode = "walk";
    let fieldOfView = 75;
    let fieldOfViewDraft: string | null = null;
    let position = "Position: —";
    let angles = "Yaw / pitch: —";
    let status = "";
    let shareable = false;

    function updateReticle() {
      if (reticle) reticle.hidden = !ready || !showReticle;
    }

    function reset() {
      ready = false;
      startCamera = null;
      position = "Position: —";
      angles = "Yaw / pitch: —";
      status = "";
      fieldOfViewDraft = null;
      updateReticle();
      handle.update();
    }

    function mapReady() {
      const runtime = element?.viewer;
      if (!runtime?.world) return;
      const camera = runtime.camera;
      startCamera = { ...camera, position: [...camera.position] };
      ready = true;
      movementMode = runtime.movementMode === "fly" ? "fly" : "walk";
      fieldOfView = camera.fieldOfView;
      fieldOfViewDraft = null;
      shareable = ["bsp", "example", "fixture", "hostedBuild"].some((key) =>
        new URL(location.href).searchParams.has(key),
      );
      updateReticle();
      refreshCamera();
      handle.update();
    }

    function refreshCamera() {
      const camera = element?.viewer?.world && element.viewer.camera;
      if (!camera) return;
      const nextPosition = `Position: ${camera.position.map((value) => value.toFixed(1)).join(" / ")}`;
      const nextAngles = `Yaw / pitch: ${((camera.yaw * 180) / Math.PI).toFixed(1)} / ${((camera.pitch * 180) / Math.PI).toFixed(1)}°`;
      if (nextPosition === position && nextAngles === angles) return;
      position = nextPosition;
      angles = nextAngles;
      handle.update();
    }

    handle.queueTask(() => {
      reticle = document.querySelector<HTMLElement>("#reticle");
      function attach() {
        if (element) return;
        element = document.querySelector<MapsViewElement>(
          "#viewport tea-map-view",
        );
        if (!element) return;
        element.addEventListener("ready", mapReady, { signal: handle.signal });
        element.addEventListener(
          "movementchange",
          (event) => {
            if (event.detail.mode !== "none") {
              movementMode = event.detail.mode;
              handle.update();
            }
          },
          { signal: handle.signal },
        );
        element.addEventListener(
          "error",
          () => {
            if (!element?.viewer?.world) reset();
          },
          { signal: handle.signal },
        );
        if (element.viewer?.world) mapReady();
      }
      window.addEventListener("tea-maps-viewer-element-ready", attach, {
        signal: handle.signal,
      });
      attach();
      window.addEventListener("tea-maps-viewer-reset", reset, {
        signal: handle.signal,
      });
      const timer = window.setInterval(refreshCamera, 100);
      handle.signal.addEventListener(
        "abort",
        () => window.clearInterval(timer),
        { once: true },
      );
    });

    async function copyLink() {
      const camera = element?.viewer?.camera;
      if (!camera) return;
      const url = new URL(location.href);
      url.searchParams.set("camera", cameraUrlValue(camera));
      try {
        await navigator.clipboard.writeText(url.href);
        status = "View link copied";
      } catch (error) {
        status = error instanceof Error ? error.message : String(error);
      }
      handle.update();
    }

    return () => (
      <section aria-label="Camera controls">
        <h2>Camera</h2>
        <label class="toggle" for="show-reticle">
          <input
            id="show-reticle"
            type="checkbox"
            checked={showReticle}
            mix={on<HTMLInputElement>("change", (event) => {
              showReticle = event.currentTarget.checked;
              updateReticle();
              handle.update();
            })}
          />
          Show reticle
        </label>
        <label for="movement-mode">Movement</label>
        <select
          id="movement-mode"
          value={movementMode}
          disabled={!ready}
          mix={on<HTMLSelectElement>("change", (event) => {
            const runtime = element?.viewer;
            if (!runtime) return;
            try {
              runtime.setMovementMode(
                event.currentTarget.value === "fly" ? "fly" : "walk",
              );
              movementMode = runtime.movementMode === "fly" ? "fly" : "walk";
            } catch (error) {
              status = error instanceof Error ? error.message : String(error);
            }
            handle.update();
          })}
        >
          <option value="walk">Walk</option>
          <option value="fly">Fly</option>
        </select>
        <label for="field-of-view">Field of view</label>
        <input
          id="field-of-view"
          type="number"
          min="45"
          max="110"
          step="1"
          value={fieldOfViewDraft ?? String(fieldOfView)}
          disabled={!ready}
          mix={[
            on<HTMLInputElement>("input", (event) => {
              fieldOfViewDraft = event.currentTarget.value;
              handle.update();
            }),
            on<HTMLInputElement>("change", (event) => {
              const value = event.currentTarget.valueAsNumber;
              fieldOfViewDraft = null;
              if (Number.isFinite(value) && value >= 45 && value <= 110)
                element?.viewer?.setCamera({ fieldOfView: value });
              fieldOfView = element?.viewer?.camera.fieldOfView ?? fieldOfView;
              handle.update();
            }),
          ]}
        />
        <button
          id="reset-camera"
          type="button"
          disabled={!ready}
          mix={on("click", () => {
            if (!startCamera) return;
            element?.viewer?.setCamera(startCamera);
            fieldOfView = startCamera.fieldOfView;
            fieldOfViewDraft = null;
            refreshCamera();
            handle.update();
          })}
        >
          Reset camera
        </button>
        <output id="camera-position" class="hint">
          {position}
        </output>
        <output id="camera-angles" class="hint">
          {angles}
        </output>
        <button
          id="copy-camera-link"
          type="button"
          disabled={!ready || !shareable}
          mix={on("click", () => void copyLink())}
        >
          Copy view link
        </button>
        <output id="camera-status" role="status">
          {status}
        </output>
      </section>
    );
  },
);
