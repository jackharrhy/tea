import { css, type Handle } from "remix/component";
import { BurgerGame } from "./game/burger-game";
import { BurgerTools } from "./game/burger-tools";

const entry = css({
  position: "fixed",
  inset: "0",
  zIndex: 10,
  display: "grid",
  placeContent: "center",
  justifyItems: "center",
  gap: "12px",
  background: "#89cbe8",
  color: "#17252b",
  font: "16px/1.4 monospace",
  "&[hidden]": { display: "none" },
  "& a": {
    padding: "8px 16px",
    border: "1px solid #30383b",
    borderRadius: "4px",
    background: "#22282a",
    color: "#fff",
    textDecoration: "none",
  },
});

export function BurgerPage(handle: Handle<{ nonce?: string }>) {
  return () => (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="theme-color" content="#f9d54e" />
        <title>Burger · Tea</title>
        <link rel="stylesheet" href="/assets/burger.css" />
      </head>
      <body>
        <main>
          <div id="burger-entry" mix={entry}>
            <div id="burger-status" role="status">
              Loading Burger…
            </div>
            <a href="/auth/login" id="burger-login">
              Sign in to play
            </a>
          </div>
          <BurgerGame />
          <BurgerTools />
        </main>
        <script
          type="module"
          src="/assets/game.js"
          nonce={handle.props.nonce}
        />
      </body>
    </html>
  );
}
