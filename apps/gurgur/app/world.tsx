import { clientEntry, ref } from "remix/component";
import { worldStyles } from "./styles";

export const GurgurWorld = clientEntry(
  "file:///app/world.tsx#GurgurWorld",
  function GurgurWorld() {
    return () => (
      <main
        id="gurgur-root"
        mix={[
          worldStyles,
          ref((root, signal) => {
            const lifetime = new AbortController();
            signal.addEventListener("abort", () => lifetime.abort(), {
              once: true,
            });
            window.addEventListener("pagehide", () => lifetime.abort(), {
              once: true,
              signal: lifetime.signal,
            });
            void (async () => {
              const { webGPUAvailable } =
                await import("../web/src/webgpu-support");
              if (lifetime.signal.aborted) return;
              const gpu = (
                navigator as Navigator & {
                  gpu?: { requestAdapter: () => Promise<unknown> };
                }
              ).gpu;
              if (!(await webGPUAvailable(gpu))) {
                if (lifetime.signal.aborted) return;
                root.dataset.webgpu = "unsupported";
                const message = document.createElement("section");
                message.id = "webgpu-unsupported";
                message.setAttribute("role", "alert");
                message.innerHTML =
                  "<h1>WebGPU is required</h1><p>Use a browser and device with WebGPU support.</p>";
                root.querySelector("canvas")?.replaceWith(message);
                return;
              }
              root.dataset.webgpu = "ready";
              const { mountGurgur } = await import("../web/src/client");
              if (lifetime.signal.aborted) return;
              await mountGurgur(root, lifetime.signal);
            })().catch((error) => {
              if (lifetime.signal.aborted) return;
              lifetime.abort();
              console.error("Gurgur could not start", error);
              root.dataset.webgpu = "error";
            });
          }),
        ]}
      >
        <canvas id="world" tabIndex={0} aria-label="Gurgur game world" />
        <form id="speech-chat" hidden>
          <label htmlFor="speech-text">Say</label>
          <input
            id="speech-text"
            name="speech"
            type="text"
            maxLength={120}
            autoComplete="off"
            spellCheck={true}
            aria-describedby="speech-status"
          />
        </form>
        <output id="speech-status" aria-live="polite" hidden />
      </main>
    );
  },
);
