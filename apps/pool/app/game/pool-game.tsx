import { clientEntry, ref, type Handle } from "remix/component";

export const PoolGame = clientEntry(
  "file:///app/game/pool-game.tsx#PoolGame",
  function PoolGame(_handle: Handle) {
    return () => (
      <canvas
        id="world"
        aria-label="Pool hall. Click to walk or join a table. At the table, aim, hold and pull back to shoot. Use arrow keys to aim and hold Space for power. Escape cancels a shot or returns to the hall."
        tabIndex={0}
        mix={ref((canvas, signal) => {
          void import("./client")
            .then(({ GameClient }) => {
              if (signal.aborted) return;
              const root = canvas.closest<HTMLElement>("#pool-root");
              if (!root) throw new Error("Pool root is missing");
              const game = new GameClient(root, canvas);
              signal.addEventListener("abort", () => game.dispose(), {
                once: true,
              });
              window.addEventListener("pagehide", () => game.dispose(), {
                once: true,
                signal,
              });
              window.addEventListener("beforeunload", () => game.dispose(), {
                once: true,
                signal,
              });
              void game.start().catch((error) => {
                game.dispose();
                if (!signal.aborted)
                  console.error("Pool could not start", error);
              });
            })
            .catch((error) => {
              if (!signal.aborted) console.error("Pool could not load", error);
            });
        })}
      />
    );
  },
);
