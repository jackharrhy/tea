import { projectsStyles } from "./projects-styles.ts";

export function NotFoundPage() {
  return () => (
    <html lang="en" mix={projectsStyles}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#10221c" />
        <title>Page not found · Maps · Tea</title>
        <link rel="icon" href="/favicon.svg" />
      </head>
      <body>
        <main class="projects-content">
          <a class="projects-brand" href="/" data-rmx-document>
            tea/maps
          </a>
          <section class="projects-error" aria-labelledby="not-found-title">
            <small>Error 404</small>
            <h1 id="not-found-title">This page does not exist</h1>
            <p>The link may be incomplete, or the project may have moved.</p>
            <nav aria-label="Recovery">
              <a href="/projects" data-rmx-document>
                Back to projects
              </a>
              <a href="/" data-rmx-document>
                Open viewer
              </a>
            </nav>
          </section>
        </main>
      </body>
    </html>
  );
}
