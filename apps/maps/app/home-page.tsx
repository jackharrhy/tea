import { homeStyles } from "./home-styles.ts";

export function HomePage() {
  return () => (
    <html lang="en" mix={homeStyles}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#252527" />
        <title>Maps · Tea</title>
        <link rel="icon" href="/favicon.svg" />
        <link rel="stylesheet" href="/icons/style.css" />
      </head>
      <body>
        <div class="home-shell">
          <header class="home-topbar">
            <a class="home-brand" href="/" aria-current="page">
              tea<span>/</span>maps
            </a>
            <nav aria-label="Maps navigation">
              <a href="/projects">Projects</a>
              <a href="/new-map">New map</a>
            </nav>
          </header>
          <main class="home-main">
            <div class="home-heading">
              <span class="home-eyebrow">MAP WORKSPACE</span>
              <h1>Start</h1>
              <p>Open a map in the viewer or work on one in the editor.</p>
            </div>
            <div class="home-choices">
              <a class="home-choice home-choice-viewer" href="/viewer">
                <span class="home-choice-icon" aria-hidden="true">
                  <i class="ph ph-eye" />
                </span>
                <span class="home-choice-body">
                  <span class="home-choice-kicker">01 / EXPLORE</span>
                  <strong>Viewer</strong>
                  <span class="home-choice-description">
                    Walk through BSPs, open local files, and inspect hosted
                    builds.
                  </span>
                </span>
                <i
                  class="ph ph-arrow-up-right home-choice-arrow"
                  aria-hidden="true"
                />
              </a>
              <a class="home-choice home-choice-editor" href="/editor">
                <span class="home-choice-icon" aria-hidden="true">
                  <i class="ph ph-cube" />
                </span>
                <span class="home-choice-body">
                  <span class="home-choice-kicker">02 / CREATE</span>
                  <strong>Editor</strong>
                  <span class="home-choice-description">
                    Shape geometry, work with projects, and build maps.
                  </span>
                </span>
                <i
                  class="ph ph-arrow-up-right home-choice-arrow"
                  aria-hidden="true"
                />
              </a>
            </div>
            <div class="home-footnote">
              <span>Already working on something?</span>
              <a href="/projects">
                Open projects <i class="ph ph-arrow-right" aria-hidden="true" />
              </a>
            </div>
          </main>
          <footer class="home-footer">
            <span>tea / maps</span>
            <span>Viewer · Editor · Projects</span>
          </footer>
        </div>
      </body>
    </html>
  );
}
