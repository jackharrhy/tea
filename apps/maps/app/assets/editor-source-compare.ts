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

export interface SourceComparisonRequest {
  readonly localName: string;
  readonly localSource: string;
  readonly hostedName: string;
  readonly hostedSource: string;
  readonly hostedVersion: number;
}

export function initSourceComparison() {
  let ready = false;
  let pending: SourceComparisonRequest | null = null;

  function showPending() {
    if (!ready || !pending) return;
    window.dispatchEvent(
      new CustomEvent<SourceComparisonRequest>("tea-maps-source-compare-open", {
        detail: pending,
      }),
    );
    pending = null;
  }

  window.addEventListener("tea-maps-source-compare-ready", () => {
    ready = true;
    showPending();
  });
  window.dispatchEvent(new Event("tea-maps-source-compare-bridge-ready"));
  return {
    show(options: SourceComparisonRequest) {
      pending = options;
      showPending();
    },
  };
}
