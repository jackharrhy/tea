import { css } from "remix/component";
import type { GardenConfig } from "../config.ts";
import type { GardenEntry } from "../content/store.ts";
import type { LinkblogRaindropStatus } from "../content/linkblog-raindrop.ts";
import { document } from "./document.tsx";

export function comparePath(value: string | null) {
  return value?.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")
    ? value
    : "/";
}

const compareStyles = css({
  margin: 0,
  height: "100vh",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  fontFamily: "monospace",
  background: "#1a1a1a",
  color: "#eee",
  "& *": { boxSizing: "border-box" },
  "& form, & nav": {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    padding: "0.4rem 0.75rem",
    background: "#111",
  },
  "& input, & select, & textarea, & button": {
    font: "inherit",
    color: "#eee",
    background: "#222",
    border: "1px solid #444",
    padding: "0.3rem",
  },
  "& input, & textarea": { flex: 1 },
  "& section": { display: "flex", flex: 1, minHeight: 0 },
  "& article": {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
  },
  "& article a": { color: "#aaa", fontSize: "0.7rem", padding: "0.3rem" },
  "& iframe": { width: "100%", flex: 1, border: 0, background: "#fff" },
});

export function compare(
  _config: GardenConfig,
  entries: GardenEntry[],
  pathname: string,
  note: string,
  baseline: string,
) {
  const paths = [
    "/",
    ...entries
      .filter((entry) => entry.id !== "home")
      .map((entry) => `/${entry.id}`),
  ];
  const index = paths.indexOf(pathname);
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width" />
        <title>Compare: {pathname}</title>
      </head>
      <body mix={compareStyles}>
        <form action="/debug/compare" method="get">
          <label for="page-path">Page</label>
          <input
            id="page-path"
            name="path"
            value={pathname}
            list="garden-pages"
          />
          <datalist id="garden-pages">
            {paths.map((value) => (
              <option value={value} />
            ))}
          </datalist>
          <button type="submit">Go</button>
        </form>
        <nav>
          <a
            href={`/debug/compare?path=${encodeURIComponent(paths[Math.max(0, index - 1)])}`}
          >
            Previous
          </a>
          <a
            href={`/debug/compare?path=${encodeURIComponent(paths[Math.min(paths.length - 1, index + 1)])}`}
          >
            Next
          </a>
          <a href="/debug">Index</a>
        </nav>
        <form action="/debug/notes" method="post" data-compare-note>
          <input type="hidden" name="path" value={pathname} />
          <label for="compare-note">Notes</label>
          <textarea id="compare-note" name="note" defaultValue={note} />
          <button type="submit">Save note</button>
          <span role="status" />
        </form>
        <section>
          {[
            ["Local Remix", pathname],
            ["Baseline", baseline + pathname],
          ].map(([label, href]) => (
            <article>
              <a href={href} target="_blank" rel="noopener">
                {label}: {href}
              </a>
              <iframe src={href} title={label} />
            </article>
          ))}
        </section>
        <script type="module" src="/assets/app/ui/public/debug.js" />
      </body>
    </html>
  );
}

export function raindropStatus(
  config: GardenConfig,
  status?: LinkblogRaindropStatus,
  error?: string,
) {
  return document({
    ...config,
    title: "Debug Linkblog",
    children: (
      <>
        <p>
          <a href="/debug">← Debug</a>
        </p>
        <h1>Linkblog Raindrop</h1>
        {error ? (
          <p>{error}</p>
        ) : (
          status && (
            <>
              <p>
                Collection: <code>{status.collectionTitle}</code> ·{" "}
                <a href="?refresh">refresh cache</a>
              </p>
              <p>
                Days: {status.totalDays} total · {status.todoDays} todo ·{" "}
                {status.completedDays} completed
              </p>
              <p>
                Links: {status.total} total · {status.todo.length} todo ·{" "}
                {status.completed.length} completed
              </p>
              <h2>Next Todo Days</h2>
              {Object.entries(status.todoByDate)
                .toSorted(([a], [b]) => a.localeCompare(b))
                .slice(0, 3)
                .map(([date, items]) => (
                  <section>
                    <h3>
                      {date} ·{" "}
                      <a
                        href={`obsidian://open?${new URLSearchParams({ vault: process.env.GARDEN_OBSIDIAN_VAULT || "vault", file: "Garden/" + items[0].draftPage })}`}
                      >
                        Open draft in Obsidian
                      </a>
                    </h3>
                    <ul>
                      {items.map((item) => (
                        <li>
                          <a href={item.link}>{item.title}</a>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
            </>
          )
        )}
      </>
    ),
  });
}
