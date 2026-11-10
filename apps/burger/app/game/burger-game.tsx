import { clientEntry, ref, type Handle } from "remix/component";
import type { Me } from "../types";

export const BurgerGame = clientEntry(
  "file:///app/game/burger-game.tsx#BurgerGame",
  function BurgerGame(_handle: Handle) {
    return () => (
      <div
        id="game-root"
        mix={ref((parent, signal) => {
          const status = document.getElementById("burger-status");
          const login = document.getElementById("burger-login");
          const logout = document.getElementById("burger-logout");
          void fetch("/auth/me", { signal, credentials: "same-origin" })
            .then(async (response) => {
              if (!response.ok) {
                if (status) status.textContent = "Sign in to play.";
                return;
              }
              const user = (await response.json()) as Me;
              if (signal.aborted) return;
              const { startGame } = await import("./index");
              if (signal.aborted) return;
              if (status) status.textContent = `Playing as ${user.displayName ?? user.username}`;
              if (login) login.hidden = true;
              if (logout) logout.hidden = false;
              const stop = startGame(parent, user);
              signal.addEventListener("abort", stop, { once: true });
            })
            .catch((error) => {
              if (signal.aborted) return;
              console.error("Burger could not start", error);
              if (status) status.textContent = "Burger could not load. Try refreshing.";
            });
        })}
      />
    );
  },
);
