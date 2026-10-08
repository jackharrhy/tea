import { Upload } from "tus-js-client";

export const UPLOAD_CHUNK_BYTES = 1024 * 1024;
export const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;

export interface UploadProgress {
  phase: "transfer" | "processing" | "finalizing";
  current: number;
  total: number;
  message: string;
}

export interface ArchiveAnalysis {
  originalName: string;
  archiveType: string;
  totalFiles: number;
  totalDirs: number;
  suggestedName: string;
  suggestedSlug: string;
  sampleFiles: string[];
}

export type UploadMetadata = {
  path: string;
  sha256: string;
} & (
  | {
      purpose: "file";
      parentFolder: string;
      sourceArchive?: string;
      batchId?: string;
    }
  | { purpose: "archive" }
);

export type UploadResult =
  | { purpose: "file"; path: string; fileId: string; pendingUpload: boolean }
  | { purpose: "archive"; archiveAnalysis: ArchiveAnalysis };

async function pause(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

interface UploadClientOptions {
  serverUrl: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
}

/** Shared browser/CLI transport; tus owns byte offsets and transfer retries. */
export class UploadClient {
  private options: UploadClientOptions;
  constructor(options: UploadClientOptions) {
    this.options = options;
  }

  private async request<T>(
    path: string,
    init: RequestInit = {},
    retry = false,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(`${this.options.serverUrl}${path}`, {
          ...init,
          headers: { ...this.options.headers, ...init.headers },
          signal: this.options.signal,
        });
        if (response.ok) return (await response.json()) as T;
        if (!retry || response.status < 500 || attempt === 4)
          throw new Error(
            `Upload request failed (${response.status}): ${await response.text()}`,
          );
        await response.body?.cancel();
      } catch (error) {
        if (!retry || !(error instanceof TypeError) || attempt === 4)
          throw error;
      }
      await pause(1000 * (attempt + 1), this.options.signal);
    }
  }

  private async waitForJob<T>(
    jobId: string,
    phase: "processing" | "finalizing",
  ): Promise<T> {
    for (;;) {
      const job = await this.request<{
        status: string;
        error: string | null;
        output: T;
        progress: number;
        progressMessage?: string | null;
      }>(`/api/uploads/jobs/${encodeURIComponent(jobId)}`, {}, true);
      this.options.onProgress?.({
        phase,
        current: job.status === "completed" ? 100 : (job.progress ?? 0),
        total: 100,
        message:
          job.progressMessage ??
          (job.status === "pending"
            ? "Waiting for server worker…"
            : "Processing on server…"),
      });
      if (job.status === "completed") return job.output;
      if (job.status === "failed" || job.status === "cancelled")
        throw new Error(
          `Upload job ${jobId} ${job.status}: ${job.error ?? "No details"}`,
        );
      await pause(1000, this.options.signal);
    }
  }

  async upload(
    data: File | Buffer,
    metadata: UploadMetadata,
  ): Promise<{ uploadId: string; result: UploadResult }> {
    const size = data instanceof Uint8Array ? data.byteLength : data.size;
    if (size > MAX_UPLOAD_BYTES)
      throw new Error("Individual uploads may be at most 512 MiB");
    const { signal } = this.options;
    signal?.throwIfAborted();
    const uploadId = await new Promise<string>((resolve, reject) => {
      const done = () => signal?.removeEventListener("abort", abort);
      const abort = () => {
        void upload.abort().catch(() => {});
        done();
        reject(signal?.reason);
      };
      const upload = new Upload(data, {
        endpoint: `${this.options.serverUrl}/api/uploads`,
        headers: this.options.headers,
        metadata: { ...metadata },
        chunkSize: UPLOAD_CHUNK_BYTES,
        retryDelays: [0, 1000, 3000, 5000, 10000],
        storeFingerprintForResuming: false,
        onProgress: (current, total) =>
          this.options.onProgress?.({
            phase: "transfer",
            current,
            total,
            message: `Transferring ${metadata.path}`,
          }),
        onError(error) {
          done();
          reject(error);
        },
        onSuccess() {
          done();
          const id = new URL(upload.url!).pathname.split("/").pop()!;
          if (!/^[a-f0-9]{32}$/.test(id))
            reject(new Error("Invalid upload ID"));
          else resolve(id);
        },
      });
      signal?.addEventListener("abort", abort, { once: true });
      upload.start();
    });
    const { jobId } = await this.request<{ jobId: string }>(
      `/api/uploads/${uploadId}/commit`,
      { method: "POST" },
      true,
    );
    return {
      uploadId,
      result: await this.waitForJob<UploadResult>(jobId, "processing"),
    };
  }

  async finalize(parentFolder: string): Promise<{ finalized: number }> {
    const result = await this.request<
      { jobId: string } | { finalized: number }
    >("/api/uploads/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentFolder }),
    });
    return "jobId" in result
      ? this.waitForJob(result.jobId, "finalizing")
      : result;
  }
}
