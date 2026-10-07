import type { WorldviewMovementSettings } from "@tea/maps-renderer";
import type { WorldViewElement } from "@tea/maps-renderer/element";
import { clientEntry, on, type Handle } from "remix/component";

const fields = [
  {
    key: "maxSpeed",
    id: "movement-max-speed",
    label: "Max speed",
    min: 100,
    max: 400,
    step: 1,
  },
  {
    key: "accelerate",
    id: "movement-accelerate",
    label: "Ground acceleration",
    min: 1,
    max: 20,
    step: 0.1,
  },
  {
    key: "airAccelerate",
    id: "movement-air-accelerate",
    label: "Air acceleration",
    min: 0,
    max: 100,
    step: 0.1,
  },
  {
    key: "friction",
    id: "movement-friction",
    label: "Friction",
    min: 0,
    max: 10,
    step: 0.1,
  },
  {
    key: "stopSpeed",
    id: "movement-stop-speed",
    label: "Stop speed",
    min: 0,
    max: 200,
    step: 1,
  },
  {
    key: "mouseSensitivity",
    id: "movement-mouse-sensitivity",
    label: "Mouse sensitivity",
    min: 0.1,
    max: 10,
    step: 0.1,
  },
  {
    key: "mouseAcceleration",
    id: "movement-mouse-acceleration",
    label: "Mouse acceleration",
    min: 0,
    max: 0.1,
    step: 0.002,
  },
  {
    key: "viewBob",
    id: "movement-view-bob",
    label: "View bob",
    min: 0,
    max: 2,
    step: 0.05,
  },
] as const;

export const ViewerMovementPanel = clientEntry(
  `${import.meta.url}#ViewerMovementPanel`,
  function ViewerMovementPanelComponent(handle: Handle) {
    let element: WorldViewElement | null = null;
    let settings: WorldviewMovementSettings | null = null;
    let status = "";

    function updateSettings(next: WorldviewMovementSettings) {
      settings = { ...next };
      handle.update();
    }

    function mapReady() {
      const runtime = element?.viewer;
      if (runtime?.world) updateSettings(runtime.movement);
    }

    function reset() {
      settings = null;
      status = "";
      handle.update();
    }

    handle.queueTask(() => {
      function attach() {
        if (element) return;
        element = document.querySelector<WorldViewElement>(
          "#viewport world-view",
        );
        if (!element) return;
        element.addEventListener("ready", mapReady, { signal: handle.signal });
        element.addEventListener(
          "movementchange",
          (event) => {
            if (element?.viewer?.world) updateSettings(event.detail.settings);
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
      window.addEventListener("tea-maps-viewer-reset", reset, {
        signal: handle.signal,
      });
      attach();
    });

    return () => (
      <section aria-label="Movement settings">
        <details class="movement-settings">
          <summary>Movement settings</summary>
          <div class="movement-fields">
            {fields.map((field) => (
              <label for={field.id}>
                {field.label}
                <input
                  id={field.id}
                  type="number"
                  min={String(field.min)}
                  max={String(field.max)}
                  step={String(field.step)}
                  value={settings ? String(settings[field.key]) : ""}
                  disabled={!settings}
                  mix={on<HTMLInputElement>("change", (event) => {
                    const runtime = element?.viewer;
                    if (!runtime?.world) return;
                    const input = event.currentTarget;
                    const value = input.valueAsNumber;
                    if (!input.checkValidity() || !Number.isFinite(value)) {
                      input.value = String(runtime.movement[field.key]);
                      return;
                    }
                    try {
                      runtime.setMovement({ [field.key]: value });
                      status = "";
                    } catch (error) {
                      status =
                        error instanceof Error ? error.message : String(error);
                    }
                    updateSettings(runtime.movement);
                  })}
                />
              </label>
            ))}
          </div>
          <output role="status">{status}</output>
        </details>
      </section>
    );
  },
);
