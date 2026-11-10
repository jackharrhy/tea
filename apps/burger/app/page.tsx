import { BurgerGame } from "./game/burger-game";
import { BurgerTools } from "./game/burger-tools";

export function BurgerPage() {
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
          <div id="burger-status" role="status">
            Loading Burger…
          </div>
          <BurgerGame />
          <BurgerTools />
          <nav aria-label="Account">
            <a href="/auth/login" id="burger-login">
              Sign in to play
            </a>
            <form method="post" action="/auth/logout" id="burger-logout" hidden>
              <button type="submit">Sign out</button>
            </form>
          </nav>
        </main>
        <script type="module" src="/assets/game.js" />
      </body>
    </html>
  );
}
