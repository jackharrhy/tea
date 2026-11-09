import { clientEntry, ref, type Handle } from "remix/component";

export const PoolGame = clientEntry(
  "file:///app/game/pool-game.tsx#PoolGame",
  function PoolGame(_handle: Handle) {
    return () => (
      <canvas
        id="world"
        aria-label="Pool hall. Click to walk or join a table. At the table, aim, hold and pull back to shoot. Use arrow keys to aim and hold Space for power. Escape cancels a shot or returns to the hall."
        tabIndex={0}
        mix={ref((_canvas, signal) => {
          void import("./client").then(({ GameClient }) => {
            if (signal.aborted) return;
            const game = new GameClient();
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
            void game
              .start()
              .catch((error) => console.error("Pool could not start", error));
          });
        })}
      />
    );
  },
);
