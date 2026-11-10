import {
  DEBUG_PHYSICS_CAPTURE_SECONDS,
  debugPhysicsCaptureFilename,
  type DebugPhysicsCaptureArtifact,
  type DebugPhysicsCaptureWorkerRequest,
  type DebugPhysicsCaptureWorkerResponse,
} from "./debug-capture";
import type { PredictionTraceFrame } from "./prediction-trace";

const captures = new Map<string, PredictionTraceFrame[]>();

self.addEventListener(
  "message",
  async (event: MessageEvent<DebugPhysicsCaptureWorkerRequest>) => {
    const message = event.data;
    try {
      if (message.type === "start") {
        captures.set(message.captureId, []);
        return;
      }
      if (message.type === "cancel") {
        captures.delete(message.captureId);
        return;
      }
      if (message.type === "frame") {
        const frames = captures.get(message.captureId);
        if (frames) frames.push(message.frame);
        return;
      }

      const frames = captures.get(message.captureId);
      if (!frames)
        throw new Error(
          "physics capture worker is missing the active recording",
        );
      captures.delete(message.captureId);
      const server = JSON.parse(
        new TextDecoder().decode(message.serverJson),
      ) as unknown;
      const artifact: DebugPhysicsCaptureArtifact = {
        format: "gurgur-networked-physics-capture",
        version: 1,
        durationSeconds: DEBUG_PHYSICS_CAPTURE_SECONDS,
        ...message.metadata,
        client: { ...message.metadata.client, frames },
        server,
      };
      const json = new Blob([JSON.stringify(artifact)], {
        type: "application/json",
      });
      const compressed = typeof CompressionStream !== "undefined";
      const blob = compressed
        ? await new Response(
            json.stream().pipeThrough(new CompressionStream("gzip")),
          ).blob()
        : json;
      const serverFrameCount = Array.isArray(
        (server as { frames?: unknown }).frames,
      )
        ? (server as { frames: unknown[] }).frames.length
        : 0;
      post({
        type: "complete",
        captureId: message.captureId,
        blob,
        filename: debugPhysicsCaptureFilename(
          message.metadata.capturedAt.completedAtIso,
          compressed,
        ),
        clientFrameCount: frames.length,
        serverFrameCount,
        capturedAt: message.metadata.capturedAt,
      });
    } catch (error) {
      post({
        type: "error",
        captureId: message.captureId,
        message:
          error instanceof Error
            ? error.message
            : "physics capture assembly failed",
      });
    }
  },
);

function post(message: DebugPhysicsCaptureWorkerResponse): void {
  self.postMessage(message, []);
}
