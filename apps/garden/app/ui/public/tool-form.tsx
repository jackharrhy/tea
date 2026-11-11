import { clientEntry, Frame, on, type Handle } from "remix/component";

export const ToolForm = clientEntry(
  import.meta.url,
  function ToolForm(
    handle: Handle<{ kind: "youtube" | "tweet"; action: string }>,
  ) {
    let pending = false;
    let error = "";
    return () => (
      <>
        <div class="not-prose my-10">
          <form
            method="post"
            action={handle.props.action}
            class="flex flex-col items-center gap-6"
            mix={on("submit", async (event, signal) => {
              event.preventDefault();
              const form = event.currentTarget;
              const result = handle.frames.get("tool-result");
              if (!result) return;
              pending = true;
              error = "";
              handle.update();
              try {
                await result.reload({
                  src: form.action,
                  method: "POST",
                  body: new FormData(form),
                });
              } catch {
                if (!signal.aborted)
                  error = "Request failed. Please try again.";
              } finally {
                if (!signal.aborted) {
                  pending = false;
                  handle.update();
                }
              }
            })}
          >
            <input
              type="text"
              name="url"
              aria-label={
                handle.props.kind === "youtube"
                  ? "YouTube video URL"
                  : "Tweet URL"
              }
              placeholder={
                handle.props.kind === "youtube"
                  ? "Enter a YouTube video URL"
                  : "Enter a tweet URL"
              }
              defaultValue={
                handle.props.kind === "youtube"
                  ? ""
                  : "https://x.com/jackharrhyisme/status/1873088463257661587"
              }
              class="w-full px-4 py-2 rounded border-2 border-shade-200 focus:border-orange-300 focus:outline-none placeholder:text-shade-400"
            />
            <button
              type="submit"
              disabled={pending}
              class="w-32 bg-orange-300/20 hover:bg-orange-200/40 text-black py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {handle.props.kind === "youtube" ? "Fetch" : "Archive"}
            </button>
          </form>
        </div>
        <div id="result" aria-live="polite" aria-busy={pending}>
          {error && <p role="alert">{error}</p>}
          <Frame name="tool-result" src="/tools/result" />
        </div>
      </>
    );
  },
);
