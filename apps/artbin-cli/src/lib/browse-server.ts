import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { ScanResult } from "./scanner.ts";
import type { ApiClient } from "./api.ts";
import { runImport, type ImportResult } from "./importer.ts";

export interface BrowseServerOptions {
  scanResult: ScanResult;
  api: ApiClient;
  html: string;
  serverUrl: string;
  user: { name: string; isAdmin: boolean };
  onProgress?: (progress: ImportProgress) => void;
}

export interface ImportProgress {
  status: "idle" | "running" | "done" | "error";
  phase: string;
  current: number;
  total: number;
  message: string;
  result?: ImportResult;
  error?: string;
}

function jsonResponse(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
}

function htmlResponse(res: ServerResponse, html: string) {
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(html),
  });
  res.end(html);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

export function startBrowseServer(
  options: BrowseServerOptions,
): Promise<{ port: number; close: () => void }> {
  const { scanResult, api, html, serverUrl, user } = options;

  let importProgress: ImportProgress = {
    status: "idle",
    phase: "",
    current: 0,
    total: 0,
    message: "",
  };
  function publish(progress: ImportProgress) {
    importProgress = progress;
    options.onProgress?.(progress);
  }

  const server = createServer(async (req, res) => {
    const url = new URL(
      req.url || "/",
      `http://${req.headers.host || "localhost"}`,
    );
    const pathname = url.pathname;

    try {
      // This server can upload local files using the CLI's authenticated session.
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        (req.headers.origin && req.headers.origin !== url.origin)
      ) {
        jsonResponse(res, 403, { error: "Local same-origin requests only" });
        return;
      }
      // Serve the SPA
      if (
        req.method === "GET" &&
        (pathname === "/" || pathname === "/index.html")
      ) {
        htmlResponse(res, html);
        return;
      }

      // Return scan results
      if (req.method === "GET" && pathname === "/api/scan-results") {
        jsonResponse(res, 200, scanResult);
        return;
      }

      // Return server info and folders
      if (req.method === "GET" && pathname === "/api/info") {
        const result = await api.listFolders();
        const folders = result.folders.map(({ slug, id }) => ({ slug, id }));

        jsonResponse(res, 200, { serverUrl, user, folders });
        return;
      }

      // Trigger import
      if (req.method === "POST" && pathname === "/api/import") {
        if (!req.headers["content-type"]?.startsWith("application/json")) {
          jsonResponse(res, 415, { error: "Expected application/json" });
          return;
        }

        const body = JSON.parse(await readBody(req)) as {
          archivePaths: string[];
          destinationFolder: string;
          includeLooseFiles?: boolean;
        };
        if (
          !body ||
          !Array.isArray(body.archivePaths) ||
          body.archivePaths.some(
            (path) =>
              typeof path !== "string" ||
              !scanResult.archives.some((archive) => archive.path === path),
          ) ||
          typeof body.destinationFolder !== "string" ||
          !body.destinationFolder.trim() ||
          (body.includeLooseFiles !== undefined &&
            typeof body.includeLooseFiles !== "boolean")
        ) {
          jsonResponse(res, 400, {
            error: "Invalid import selection or destination",
          });
          return;
        }

        if (importProgress.status === "running") {
          jsonResponse(res, 409, { error: "Import already in progress" });
          return;
        }

        publish({
          status: "running",
          phase: "starting",
          current: 0,
          total: 0,
          message: "Starting import...",
        });

        // Return immediately, run import in background
        jsonResponse(res, 200, { status: "started" });

        // Fire-and-forget import
        runImport({
          scanResult,
          archivePaths: body.archivePaths,
          api,
          rootSlug: body.destinationFolder,
          includeLooseFiles: body.includeLooseFiles,
          onProgress(info) {
            publish({
              status: "running",
              phase: info.phase,
              current: info.current,
              total: info.total,
              message: info.message,
            });
          },
        })
          .then((result) => {
            publish({
              status: "done",
              phase: "done",
              current: result.uploaded,
              total: result.total,
              message: `Uploaded ${result.uploaded} files`,
              result,
            });
          })
          .catch((err) => {
            publish({
              status: "error",
              phase: "error",
              current: importProgress.current,
              total: importProgress.total,
              message: String(err),
              error: String(err),
            });
          });

        return;
      }

      // Return import progress
      if (req.method === "GET" && pathname === "/api/import-status") {
        jsonResponse(res, 200, importProgress);
        return;
      }

      // 404 for everything else
      jsonResponse(res, 404, { error: "Not found" });
    } catch (err) {
      jsonResponse(res, 500, { error: String(err) });
    }
  });

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to get server address"));
        return;
      }
      resolve({
        port: addr.port,
        close: () => server.close(),
      });
    });

    server.on("error", reject);
  });
}
