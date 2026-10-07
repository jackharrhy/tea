import type { Handle, RemixNode } from "remix/component";
import type { BoardRecord } from "../data/directory-cell.ts";
import { browserAssets } from "../assets/build-manifest.ts";
import { refStyles } from "../styles.ts";

function Document(handle: Handle<{ title: string; children?: RemixNode }>) {
  return () => (
    <html lang="en" mix={refStyles}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#f6f6f4" />
        <title>{handle.props.title} · tea/ref</title>
        <link rel="icon" href="/favicon.svg" />
      </head>
      <body>{handle.props.children}</body>
    </html>
  );
}

export function AuthPage(handle: Handle<{ error?: string }>) {
  return () => (
    <Document title="Unlock">
      <main class="auth-page">
        <form method="post" action="/login" class="auth-form">
          <a class="wordmark" href="/">
            tea<span>/ref</span>
          </a>
          <label for="password">Password</label>
          <div class="auth-row">
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
            />
            <button type="submit">Enter</button>
          </div>
          {handle.props.error && (
            <p class="error" role="alert">
              {handle.props.error}
            </p>
          )}
        </form>
      </main>
    </Document>
  );
}

export function HomePage(
  handle: Handle<{ boards: BoardRecord[]; error?: string }>,
) {
  return () => (
    <Document title="Boards">
      <main class="home-page">
        <header class="site-header">
          <a class="wordmark" href="/">
            tea<span>/ref</span>
          </a>
          <form method="post" action="/logout">
            <button class="quiet-button" type="submit">
              Lock
            </button>
          </form>
        </header>
        <section class="home-content">
          <h1>Boards</h1>
          {handle.props.error && (
            <p class="error" role="alert">
              {handle.props.error}
            </p>
          )}
          <form method="post" action="/boards" class="new-board-form">
            <input
              name="title"
              placeholder="New board"
              aria-label="New board name"
              required
              maxLength={100}
            />
            <button type="submit">Create</button>
          </form>
          <div class="board-list">
            {handle.props.boards.map((board) => (
              <a class="board-row" href={`/boards/${board.id}`}>
                <span>{board.title}</span>
                <time>{new Date(board.updatedAt).toLocaleDateString()}</time>
              </a>
            ))}
          </div>
        </section>
      </main>
    </Document>
  );
}

export function BoardPage(
  handle: Handle<{ board: BoardRecord; error?: string }>,
) {
  const board = handle.props.board;
  return () => (
    <Document title={board.title}>
      <main id="board-app" data-board-id={board.id}>
        <header class="board-header">
          <a class="back-link" href="/" aria-label="Back to boards">
            ←
          </a>
          <details class="board-title-menu">
            <summary>{board.title}</summary>
            <form method="post" action={`/boards/${board.id}/rename`}>
              <input
                name="title"
                defaultValue={board.title}
                maxLength={100}
                required
                aria-label="Board name"
              />
              <button type="submit">Rename</button>
            </form>
          </details>
          <div class="header-spacer"></div>
          <div id="connection" class="connection connecting">
            <span class="connection-dot"></span>
            <span class="connection-text">Connecting</span>
          </div>
          <button id="tool-add" class="header-add" type="button">
            Add images
          </button>
          <details id="link-menu" class="add-link-menu">
            <summary>Add link</summary>
            <form id="link-form">
              <input
                id="link-url"
                name="url"
                type="url"
                placeholder="Paste a URL"
                aria-label="Link URL"
                required
              />
              <button type="submit">Add</button>
            </form>
          </details>
        </header>
        {handle.props.error && (
          <p class="error board-error" role="alert">
            {handle.props.error}
          </p>
        )}
        <div class="board-layout">
          <section
            id="viewport"
            class="viewport"
            aria-label="Image board"
            tabIndex={0}
          >
            <div id="world" class="world"></div>
            <div id="empty-state" class="empty-state">
              <p>Drop images or links here</p>
              <button id="empty-add" type="button">
                or choose files
              </button>
            </div>
            <div class="zoom-controls">
              <button
                id="tool-fit"
                type="button"
                title="Fit board"
                aria-label="Fit board"
              >
                □
              </button>
              <button id="zoom-out" type="button" aria-label="Zoom out">
                −
              </button>
              <span id="zoom-label">100%</span>
              <button id="zoom-in" type="button" aria-label="Zoom in">
                +
              </button>
            </div>
          </section>
          <aside id="inspector" class="inspector" hidden>
            <div class="inspector-top">
              <span>Image</span>
              <button
                id="inspector-close"
                type="button"
                aria-label="Close image details"
              >
                ×
              </button>
            </div>
            <div id="inspector-content" class="inspector-content"></div>
          </aside>
        </div>
        <input
          id="file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
        />
        <div id="toast" class="toast" role="status"></div>
        <script type="module" src={browserAssets.board}></script>
      </main>
    </Document>
  );
}
