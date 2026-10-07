import type {
  MapCompileRequest,
  MapCompileResult,
  MapCompiler,
} from "./compiler.js";

export type MapCompileOutcome =
  | { readonly status: "installed"; readonly result: MapCompileResult }
  | { readonly status: "stale"; readonly result: MapCompileResult }
  | { readonly status: "failed"; readonly result: MapCompileResult }
  | { readonly status: "cancelled" };

function abortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export class MapCompileCoordinator {
  private generation = 0;
  private activeController: AbortController | null = null;

  public constructor(private readonly compiler: MapCompiler) {}

  public async compile(
    request: Omit<MapCompileRequest, "signal">,
    currentDocumentRevision: () => number,
  ): Promise<MapCompileOutcome> {
    this.cancel();
    const generation = ++this.generation;
    const controller = new AbortController();
    this.activeController = controller;
    try {
      const result = await this.compiler.compile({
        ...request,
        signal: controller.signal,
      });
      if (
        generation !== this.generation ||
        result.sourceDocumentRevision !== request.expectedDocumentRevision ||
        currentDocumentRevision() !== request.expectedDocumentRevision
      ) {
        return { status: "stale", result };
      }
      if (result.status === "failed") return { status: "failed", result };
      return { status: "installed", result };
    } catch (error) {
      if (controller.signal.aborted || abortError(error))
        return { status: "cancelled" };
      throw error;
    } finally {
      if (this.activeController === controller) this.activeController = null;
    }
  }

  public cancel(): void {
    this.generation += 1;
    this.activeController?.abort();
    this.activeController = null;
  }
}
