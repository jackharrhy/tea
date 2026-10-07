import { clientEntry, on, type Handle } from "remix/component";
import {
  compareSources,
  type SourceComparisonRequest,
} from "./editor-source-compare.ts";

export const EditorSourceComparison = clientEntry(
  `${import.meta.url}#EditorSourceComparison`,
  function EditorSourceComparisonComponent(handle: Handle) {
    let comparison: SourceComparisonRequest | null = null;

    handle.queueTask(() => {
      window.addEventListener(
        "tea-maps-source-compare-bridge-ready",
        () => window.dispatchEvent(new Event("tea-maps-source-compare-ready")),
        { signal: handle.signal },
      );
      window.addEventListener(
        "tea-maps-source-compare-open",
        (event) => {
          comparison = (event as CustomEvent<SourceComparisonRequest>).detail;
          handle.update();
          const dialog = document.querySelector<HTMLDialogElement>(
            "#source-compare-dialog",
          )!;
          if (!dialog.open) dialog.showModal();
        },
        { signal: handle.signal },
      );
      window.dispatchEvent(new Event("tea-maps-source-compare-ready"));
    });

    return () => {
      const result = comparison
        ? compareSources(comparison.localSource, comparison.hostedSource)
        : null;
      const summary =
        !comparison || !result
          ? ""
          : result.same
            ? `Sources match exactly · hosted version ${comparison.hostedVersion}`
            : `Sources differ at line ${result.firstDifferentLine ?? "end"} · local ${result.localLines} lines · hosted ${result.hostedLines} lines · hosted version ${comparison.hostedVersion}`;
      return (
        <dialog
          id="source-compare-dialog"
          aria-labelledby="source-compare-title"
        >
          <h2 id="source-compare-title">
            {comparison
              ? `${comparison.localName} ↔ ${comparison.hostedName}`
              : "Compare map sources"}
          </h2>
          <p id="source-compare-summary" role="status">
            {summary}
          </p>
          <p>
            These are read-only snapshots. The local side includes unapplied
            source edits.
          </p>
          <div class="source-compare-columns">
            <div>
              <label for="source-compare-local">Current source</label>
              <textarea
                id="source-compare-local"
                readOnly
                spellCheck={false}
                value={comparison?.localSource ?? ""}
              />
            </div>
            <div>
              <label for="source-compare-hosted">Hosted source</label>
              <textarea
                id="source-compare-hosted"
                readOnly
                spellCheck={false}
                value={comparison?.hostedSource ?? ""}
              />
            </div>
          </div>
          <button
            id="source-compare-close"
            type="button"
            mix={on("click", () =>
              document
                .querySelector<HTMLDialogElement>("#source-compare-dialog")!
                .close(),
            )}
          >
            Close
          </button>
        </dialog>
      );
    };
  },
);
