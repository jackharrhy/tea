import type { RuntimeId } from "@harrhy/gurgur-engine";
import type { PredictionTraceFrame } from "./prediction-trace";

export const DEBUG_PHYSICS_CAPTURE_SECONDS = 15;

export type ServerPhysicsCaptureStart = {
  id: string;
  worldEpoch: number;
  mapRevision: string;
  playerId: RuntimeId;
  startedAtServerTick: number;
  endingAtServerTick: number;
  durationSeconds: number;
};

export type DebugPhysicsCaptureArtifact = {
  format: "gurgur-networked-physics-capture";
  version: 1;
  durationSeconds: 15;
  capturedAt: {
    startedAtIso: string;
    completedAtIso: string;
    clientPerformanceTimeOriginMs: number;
    clientStartedAtMs: number;
    clientCompletedAtMs: number;
  };
  context: {
    url: string;
    userAgent: string;
    mapRevision: string;
    worldEpoch: number;
    localPlayerId: RuntimeId;
    network: {
      rttMs: number | null;
      jitterMs: number | null;
      transport: string | null;
      simulatedLatencyMs: number;
      simulatedJitterMs: number;
      simulatedLossRate: number;
      simulatedSeed: number;
    };
  };
  client: {
    discardedCatchUpSeconds: number;
    feel: unknown;
    frames: PredictionTraceFrame[];
  };
  server: unknown;
};

export type DebugPhysicsCaptureMetadata = Omit<
  DebugPhysicsCaptureArtifact,
  "format" | "version" | "durationSeconds" | "client" | "server"
> & {
  client: Omit<DebugPhysicsCaptureArtifact["client"], "frames">;
};

export type DebugPhysicsCaptureDownload = {
  blob: Blob;
  filename: string;
  clientFrameCount: number;
  serverFrameCount: number;
  capturedAt: DebugPhysicsCaptureArtifact["capturedAt"];
};

export type DebugPhysicsCaptureWorkerRequest =
  | { type: "start"; captureId: string }
  | { type: "frame"; captureId: string; frame: PredictionTraceFrame }
  | {
      type: "finish";
      captureId: string;
      metadata: DebugPhysicsCaptureMetadata;
      serverJson: ArrayBuffer;
    }
  | { type: "cancel"; captureId: string };

export type DebugPhysicsCaptureWorkerResponse =
  | ({ type: "complete"; captureId: string } & DebugPhysicsCaptureDownload)
  | { type: "error"; captureId: string; message: string };

export function buildDebugPhysicsCapture(
  artifact: Omit<
    DebugPhysicsCaptureArtifact,
    "format" | "version" | "durationSeconds"
  >,
): DebugPhysicsCaptureArtifact {
  return structuredClone({
    format: "gurgur-networked-physics-capture",
    version: 1,
    durationSeconds: DEBUG_PHYSICS_CAPTURE_SECONDS,
    ...artifact,
  });
}

export function debugPhysicsCaptureFilename(
  completedAtIso: string,
  compressed = true,
): string {
  const timestamp = completedAtIso.replace(/[:.]/g, "-");
  return `gurgur-physics-${timestamp}.json${compressed ? ".gz" : ""}`;
}

export function downloadDebugPhysicsCaptureBlob(
  download: DebugPhysicsCaptureDownload,
): void {
  const url = URL.createObjectURL(download.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = download.filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export class DebugPhysicsCaptureAssembler {
  readonly #worker: Worker;
  readonly #pending = new Map<
    string,
    {
      resolve(download: DebugPhysicsCaptureDownload): void;
      reject(error: Error): void;
    }
  >();

  constructor(workerUrl = "/debug-capture-worker.js") {
    this.#worker = new Worker(workerUrl, {
      type: "module",
      name: "gurgur-debug-capture",
    });
    this.#worker.addEventListener(
      "message",
      (event: MessageEvent<DebugPhysicsCaptureWorkerResponse>) => {
        const message = event.data;
        const pending = this.#pending.get(message.captureId);
        if (!pending) return;
        this.#pending.delete(message.captureId);
        if (message.type === "error")
          pending.reject(new Error(message.message));
        else {
          const { type: _type, captureId: _captureId, ...download } = message;
          pending.resolve(download);
        }
      },
    );
    this.#worker.addEventListener("error", (event) => {
      for (const pending of this.#pending.values())
        pending.reject(new Error(event.message));
      this.#pending.clear();
    });
  }

  start(captureId: string): void {
    this.#post({ type: "start", captureId });
  }

  record(captureId: string, frame: PredictionTraceFrame): void {
    this.#post({ type: "frame", captureId, frame });
  }

  finish(
    captureId: string,
    metadata: DebugPhysicsCaptureMetadata,
    serverJson: ArrayBuffer,
  ): Promise<DebugPhysicsCaptureDownload> {
    const promise = new Promise<DebugPhysicsCaptureDownload>(
      (resolve, reject) => {
        this.#pending.set(captureId, { resolve, reject });
      },
    );
    this.#worker.postMessage(
      {
        type: "finish",
        captureId,
        metadata,
        serverJson,
      } satisfies DebugPhysicsCaptureWorkerRequest,
      [serverJson],
    );
    return promise;
  }

  cancel(captureId: string): void {
    this.#post({ type: "cancel", captureId });
    const pending = this.#pending.get(captureId);
    if (pending) pending.reject(new Error("physics capture was cancelled"));
    this.#pending.delete(captureId);
  }

  dispose(): void {
    this.#worker.terminate();
    for (const pending of this.#pending.values())
      pending.reject(new Error("physics capture worker was disposed"));
    this.#pending.clear();
  }

  #post(message: DebugPhysicsCaptureWorkerRequest): void {
    this.#worker.postMessage(message, []);
  }
}
