import { clientEntry, ref, type Handle } from "remix/component";
import PicoCADViewer from "./mug/pico-cad-viewer.js";

interface MugProps {
  home: boolean;
  model: string;
}
let current:
  | { canvas: HTMLCanvasElement; viewer: InstanceType<typeof PicoCADViewer> }
  | undefined;

function afterDraw() {
  if (!performance.getEntriesByName("garden:mug-first-frame").length)
    performance.mark("garden:mug-first-frame");
}

export const Mug = clientEntry(
  import.meta.url,
  function Mug(handle: Handle<MugProps>) {
    return () => (
      <div
        class="flex justify-center"
        data-mug-slot
        data-rmx-preserve-dom
        mix={ref((slot) => {
          const { home, model } = handle.props;
          if (!current) {
            const canvas = slot.querySelector("canvas")!;
            const viewer = new PicoCADViewer({
              canvas,
              fov: 15,
              resolution: home
                ? { width: 250, height: 180 }
                : { width: 100, height: 50 },
            });
            current = { canvas, viewer };
            viewer.backgroundColor = [0, 0, 0, 0];
            viewer.load(model);
            let spin = 0;
            const draw = (dt: number) => {
              spin += dt;
              viewer.setTurntableCamera(8, spin, 0.07, { x: 0, y: 0.6, z: 0 });
              viewer.setLightDirectionFromCamera();
            };
            viewer.startDrawLoop(draw, afterDraw);
            window.addEventListener("pagehide", () => viewer.stopDrawLoop());
            window.addEventListener("pageshow", (event) => {
              if (event.persisted) viewer.startDrawLoop(draw, afterDraw);
            });
          }
          slot.replaceChildren(current.canvas);
          current.canvas.className = home ? "my-16" : "my-0";
          current.viewer.setResolution(home ? 250 : 100, home ? 180 : 50);
        })}
      >
        <canvas
          id="mug-canvas"
          class={handle.props.home ? "my-16" : "my-0"}
          width={handle.props.home ? 250 : 100}
          height={handle.props.home ? 180 : 50}
          aria-label="Spinning tea mug"
        />
      </div>
    );
  },
);
