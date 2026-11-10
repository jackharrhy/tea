import { clientEntry, ref, type Handle } from "remix/component";
import type { Me } from "../types";

export const BurgerGame = clientEntry(
  "file:///app/game/burger-game.tsx#BurgerGame",
  function BurgerGame(_handle: Handle) {
    return () => (
      <div
        id="game-root"
        mix={ref((parent, signal) => {
          const lifetime = new AbortController();
          signal.addEventListener("abort", () => lifetime.abort(), {
            once: true,
          });
          window.addEventListener("pagehide", () => lifetime.abort(), {
            once: true,
            signal: lifetime.signal,
          });
          const status = document.getElementById("burger-status");
          const login = document.getElementById("burger-login");
          const logout = document.getElementById("burger-logout");
          void fetch("/auth/me", {
            signal: lifetime.signal,
            credentials: "same-origin",
          })
            .then(async (response) => {
              if (!response.ok) {
                if (status) status.textContent = "Sign in to play.";
                return;
              }
              const user = (await response.json()) as Me;
              const paletteResponse = await fetch("/api/palette", {
                signal: lifetime.signal,
                credentials: "same-origin",
              });
              if (!paletteResponse.ok)
                throw new Error("Could not load palette");
              const palette = (await paletteResponse.json()) as {
                ok: boolean;
                ids: number[];
              };
              if (!palette.ok) throw new Error("Could not load palette");
              const [{ startGame }, { useGameStore }] = await Promise.all([
                import("./index"),
                import("../store"),
              ]);
              if (lifetime.signal.aborted) return;
              useGameStore.getState().setPalette(palette.ids);
              if (status)
                status.textContent = `Playing as ${user.displayName ?? user.username}`;
              if (login) login.hidden = true;
              if (logout) logout.hidden = false;
              const stop = startGame(parent, user);
              lifetime.signal.addEventListener("abort", stop, { once: true });
            })
            .catch((error) => {
              if (lifetime.signal.aborted) return;
              console.error("Burger could not start", error);
              if (status)
                status.textContent = "Burger could not load. Try refreshing.";
            });
        })}
      />
    );
  },
);
