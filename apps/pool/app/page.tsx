import { PoolGame } from "./game/pool-game";
import type { Handle } from "remix/component";

export function PoolPage(handle: Handle<{ nonce?: string }>) {
  return () => (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width,initial-scale=1,viewport-fit=cover"
        />
        <meta name="theme-color" content="#151b18" />
        <title>Pool · Tea</title>
        <link
          rel="icon"
          href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='30' fill='%23121815'/%3E%3Ccircle cx='32' cy='26' r='15' fill='%23f4efdf'/%3E%3Ctext x='32' y='36' text-anchor='middle' font-family='sans-serif' font-size='28' fill='%23121815'%3E8%3C/text%3E%3C/svg%3E"
        />
        <link rel="stylesheet" href="/assets/game.css" />
      </head>
      <body>
        <main id="pool-root">
          <PoolGame />
          <div id="connection" class="sr-only" role="status">
            Preparing the hall…
          </div>
          <form id="entry">
            <label for="name">Your name</label>
            <div>
              <input
                id="name"
                maxLength={24}
                autoComplete="nickname"
                placeholder="Name"
                required
              />
              <input
                id="player-color"
                type="color"
                value="#e8a55d"
                aria-label="Player colour"
                title="Player colour"
              />
              <button type="submit" disabled>
                Enter the hall
              </button>
            </div>
            <a id="sign-in" href="/auth/login" hidden>
              Sign in
            </a>
          </form>
          <section id="table-ui" hidden aria-label="Pool table">
            <div id="score" class="sr-only" />
            <p id="turn" class="sr-only" role="status" />
            <p id="message" class="sr-only" />
            <div id="table-actions">
              <button id="take-seat" hidden>
                Join table
              </button>
              <button id="rematch" hidden>
                Play again
              </button>
            </div>
          </section>
          <details id="menu" hidden>
            <summary aria-label="Hall menu">
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                aria-hidden="true"
              >
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </summary>
            <nav aria-label="Hall actions">
              <button id="back" hidden>
                View hall
              </button>
              <button id="invite" hidden>
                Invite friends
              </button>
              <button id="sound" aria-label="Turn sound on">
                Sound off
              </button>
              <div id="nearby" hidden>
                <span id="nearby-text" />
                <button id="join">
                  Join table <kbd>E</kbd>
                </button>
                <button id="watch">Watch</button>
              </div>
            </nav>
          </details>
          <button id="leave" hidden>
            Leave table
          </button>
          <div id="toast" role="status" hidden />
          <aside id="chat" aria-label="Hall chat">
            <ol id="messages" aria-live="polite" />
            <button
              id="chat-toggle"
              aria-controls="chat-form"
              aria-expanded="false"
            >
              Chat <span aria-hidden="true">[T]</span>
            </button>
            <form id="chat-form" hidden>
              <label class="sr-only" for="chat-input">
                Message the hall
              </label>
              <input
                id="chat-input"
                maxLength={160}
                placeholder="Say something…"
                autoComplete="off"
              />
              <button type="submit">Send</button>
            </form>
          </aside>
          <div id="touch" hidden>
            <div id="stick" aria-label="Drag to walk">
              <i />
            </div>
          </div>
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
