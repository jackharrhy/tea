import { clientEntry, css, on, ref, type Handle } from "remix/component";
import { FileCollection, type FileItem } from "../file-collection.tsx";
import { buttonStyle, theme } from "../styles.ts";

type Props = {
  files: FileItem[];
  nextHref?: string | null;
  grid?: boolean;
  showAudioPlayers?: boolean;
};

export const InfiniteFiles = clientEntry(
  import.meta.url,
  function InfiniteFiles(handle: Handle<Props>) {
    let initialFiles = handle.props.files;
    let files = [...initialFiles];
    let nextHref = handle.props.nextHref;
    let request: AbortController | undefined;
    let error = false;

    handle.signal.addEventListener("abort", () => request?.abort());

    async function loadMore() {
      if (!nextHref || request) return;
      const href = nextHref;
      const controller = new AbortController();
      request = controller;
      error = false;
      handle.update();
      try {
        const response = await fetch(href, {
          headers: { Accept: "application/json" },
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(30_000),
          ]),
        });
        if (
          !response.ok ||
          !response.headers.get("content-type")?.includes("application/json")
        ) {
          throw new Error("Could not load files");
        }
        const page = (await response.json()) as {
          files: FileItem[];
          nextCursor: string | null;
        };
        if (controller.signal.aborted) return;
        if (
          !Array.isArray(page.files) ||
          (page.nextCursor !== null && typeof page.nextCursor !== "string")
        )
          throw new Error("Invalid file page");
        if (page.nextCursor) {
          const url = new URL(href, location.href);
          if (url.searchParams.get("cursor") === page.nextCursor)
            throw new Error("File cursor did not advance");
          url.searchParams.set("cursor", page.nextCursor);
          nextHref = `${url.pathname}${url.search}`;
        } else nextHref = null;
        const seen = new Set(files.map((file) => file.id));
        files = [...files, ...page.files.filter((file) => !seen.has(file.id))];
      } catch {
        if (!controller.signal.aborted) error = true;
      } finally {
        if (request === controller) {
          request = undefined;
          if (!controller.signal.aborted) handle.update();
        }
      }
    }

    return () => {
      if (initialFiles !== handle.props.files) {
        request?.abort();
        request = undefined;
        initialFiles = handle.props.files;
        files = [...initialFiles];
        nextHref = handle.props.nextHref;
        error = false;
      }
      return (
        <div>
          <FileCollection
            files={files}
            grid={handle.props.grid}
            showAudioPlayers={handle.props.showAudioPlayers}
          />
          {nextHref ? (
            <div
              key={`${nextHref}-${Boolean(request)}-${error}`}
              mix={[
                css({
                  padding: "2rem",
                  textAlign: "center",
                  color: theme.color.muted,
                }),
                ref((element, signal) => {
                  if (
                    request ||
                    error ||
                    typeof IntersectionObserver === "undefined"
                  )
                    return;
                  const observer = new IntersectionObserver(
                    (entries) => {
                      if (entries.some((entry) => entry.isIntersecting))
                        void loadMore();
                    },
                    { rootMargin: "300px" },
                  );
                  observer.observe(element);
                  signal.addEventListener("abort", () => observer.disconnect());
                }),
              ]}
            >
              <p role="status">
                {request
                  ? "Loading more files…"
                  : error
                    ? "Could not load more files. Try again."
                    : `${files.length} files loaded`}
              </p>
              <a
                href={nextHref}
                aria-disabled={Boolean(request)}
                mix={[
                  buttonStyle,
                  on("click", (event) => {
                    if (
                      event.button !== 0 ||
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    )
                      return;
                    event.preventDefault();
                    void loadMore();
                  }),
                ]}
              >
                {error ? "Retry" : "Load more"}
              </a>
            </div>
          ) : null}
        </div>
      );
    };
  },
);
