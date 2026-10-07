import type { Track } from "../data/protocol.ts";

export interface UploadProgress {
  bytesSent: number;
  sizeBytes: number;
}

export function uploadTrackContent(options: {
  url: string;
  file: File;
  signal: AbortSignal;
  onProgress: (progress: UploadProgress) => void;
  createRequest?: () => XMLHttpRequest;
}): Promise<Track> {
  return new Promise((resolve, reject) => {
    let request = options.createRequest?.() ?? new XMLHttpRequest();
    let rejectWithResponse = () => {
      let body = parseResponse(request.responseText);
      reject(new Error(body?.error ?? "Upload failed"));
    };
    let abort = () => request.abort();

    request.open("PUT", options.url);
    request.setRequestHeader(
      "Content-Type",
      options.file.type || "application/octet-stream",
    );
    request.upload.addEventListener("progress", (event) => {
      options.onProgress({
        bytesSent: event.loaded,
        sizeBytes: event.lengthComputable ? event.total : options.file.size,
      });
    });
    request.addEventListener("load", () => {
      options.signal.removeEventListener("abort", abort);
      if (request.status < 200 || request.status >= 300) {
        rejectWithResponse();
        return;
      }
      let body = parseResponse(request.responseText);
      if (!body?.track) {
        reject(new Error("Upload response was invalid"));
        return;
      }
      resolve(body.track);
    });
    request.addEventListener("error", () => {
      options.signal.removeEventListener("abort", abort);
      rejectWithResponse();
    });
    request.addEventListener("abort", () => {
      options.signal.removeEventListener("abort", abort);
      reject(new DOMException("Upload aborted", "AbortError"));
    });
    options.signal.addEventListener("abort", abort, { once: true });
    request.send(options.file);
  });
}

function parseResponse(
  value: string,
): { track?: Track; error?: string } | null {
  try {
    return JSON.parse(value) as { track?: Track; error?: string };
  } catch {
    return null;
  }
}
