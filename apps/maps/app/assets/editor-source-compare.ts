export interface SourceComparison {
  readonly same: boolean;
  readonly localLines: number;
  readonly hostedLines: number;
  readonly firstDifferentLine: number | null;
}

export function compareSources(
  local: string,
  hosted: string,
): SourceComparison {
  const localRows = local.split("\n");
  const hostedRows = hosted.split("\n");
  let firstDifferentLine: number | null = null;
  for (
    let index = 0;
    index < Math.max(localRows.length, hostedRows.length);
    index += 1
  ) {
    if (localRows[index] !== hostedRows[index]) {
      firstDifferentLine = index + 1;
      break;
    }
  }
  return {
    same: local === hosted,
    localLines: localRows.length,
    hostedLines: hostedRows.length,
    firstDifferentLine,
  };
}

export function initSourceComparison() {
  const dialog = document.querySelector<HTMLDialogElement>(
    "#source-compare-dialog",
  )!;
  const title = document.querySelector<HTMLElement>("#source-compare-title")!;
  const summary = document.querySelector<HTMLElement>(
    "#source-compare-summary",
  )!;
  const local = document.querySelector<HTMLTextAreaElement>(
    "#source-compare-local",
  )!;
  const hosted = document.querySelector<HTMLTextAreaElement>(
    "#source-compare-hosted",
  )!;
  const close = document.querySelector<HTMLButtonElement>(
    "#source-compare-close",
  )!;
  close.addEventListener("click", () => dialog.close());

  return {
    show(options: {
      readonly localName: string;
      readonly localSource: string;
      readonly hostedName: string;
      readonly hostedSource: string;
      readonly hostedVersion: number;
    }) {
      const result = compareSources(options.localSource, options.hostedSource);
      title.textContent = `${options.localName} ↔ ${options.hostedName}`;
      summary.textContent = result.same
        ? `Sources match exactly · hosted version ${options.hostedVersion}`
        : `Sources differ at line ${result.firstDifferentLine ?? "end"} · local ${result.localLines} lines · hosted ${result.hostedLines} lines · hosted version ${options.hostedVersion}`;
      local.value = options.localSource;
      hosted.value = options.hostedSource;
      dialog.showModal();
    },
  };
}
