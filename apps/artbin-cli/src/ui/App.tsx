import React, { useCallback, useEffect, useState } from "react";
import { ScanTreeView } from "@artbin/ui/ScanTreeView";
import { ArchiveItem } from "@artbin/ui/ArchiveItem";
import { BatchControls } from "@artbin/ui/BatchControls";
import { buildTree, getAllArchivePaths } from "@artbin/ui/tree-utils";
import type { FoundArchive, TreeNode } from "@artbin/ui/types";
import { DestinationPicker } from "./DestinationPicker";
import type { ImportProgress } from "../lib/browse-server";

interface ScanResult {
  archives: {
    path: string;
    relativePath: string;
    name: string;
    size: number;
    type: string;
    gameDir: string | null;
    entries: { name: string }[];
  }[];
  looseFiles: { path: string; name: string; size: number }[];
  totalFileCount: number;
  totalSize: number;
}

interface ServerInfo {
  serverUrl: string;
  user: { name: string; isAdmin: boolean };
  folders: { slug: string; id: string }[];
}

type View = "browse" | "importing" | "done";

export function App() {
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [destinationFolder, setDestinationFolder] = useState("");
  const [newFolderSlug, setNewFolderSlug] = useState("");
  const [includeLooseFiles, setIncludeLooseFiles] = useState(false);
  const [view, setView] = useState<View>("browse");
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(
    null,
  );

  // Fetch scan results and info on mount
  useEffect(() => {
    Promise.all([
      fetch("/api/scan-results").then(readJson),
      fetch("/api/info").then(readJson),
    ])
      .then(([scan, serverInfo]: [ScanResult, ServerInfo]) => {
        setScanResult(scan);
        setInfo(serverInfo);
        if (serverInfo.folders.length > 0) {
          setDestinationFolder(
            serverInfo.folders.find((folder) => !folder.slug.includes("/"))
              ?.slug ?? "",
          );
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, []);

  const tree: TreeNode | null = scanResult
    ? buildTree(
        scanResult.archives.map((a) => ({
          path: a.path,
          relativePath: a.relativePath,
          name: a.name,
          type: a.type,
          size: a.size,
          fileCount: a.entries.length || 1,
          gameDir: a.gameDir,
        })),
      )
    : null;

  const handleToggleFolder = useCallback(
    (paths: string[], selected: boolean) => {
      setSelectedPaths((prev) => {
        const next = new Set(prev);
        for (const p of paths) {
          if (selected) {
            next.add(p);
          } else {
            next.delete(p);
          }
        }
        return next;
      });
    },
    [],
  );

  const handleToggleSingle = useCallback((path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (!tree) return;
    const allPaths = getAllArchivePaths(tree);
    setSelectedPaths(new Set(allPaths));
    setIncludeLooseFiles(true);
  }, [tree]);

  const handleClearSelection = useCallback(() => {
    setSelectedPaths(new Set());
    setIncludeLooseFiles(false);
  }, []);

  const handleImport = useCallback(
    async (close: () => void) => {
      const folder = destinationFolder || newFolderSlug;
      if (!folder) return;

      close();
      setView("importing");

      try {
        const response = await fetch("/api/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            archivePaths: Array.from(selectedPaths),
            destinationFolder: folder,
            includeLooseFiles,
          }),
        });
        await readJson(response);
      } catch (err) {
        setImportProgress({
          status: "error",
          phase: "error",
          current: 0,
          total: 0,
          message: String(err),
          error: String(err),
        });
        setView("done");
      }
    },
    [selectedPaths, destinationFolder, newFolderSlug, includeLooseFiles],
  );

  useEffect(() => {
    if (view !== "importing") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const progress: ImportProgress = await fetch("/api/import-status", {
          signal: controller.signal,
        }).then(readJson);
        if (controller.signal.aborted) return;
        setImportProgress(progress);
        if (progress.status === "done" || progress.status === "error") {
          setView("done");
          return;
        }
      } catch (pollError) {
        if (controller.signal.aborted) return;
        setImportProgress((previous) => ({
          ...previous,
          status: "running",
          phase: previous?.phase ?? "starting",
          current: previous?.current ?? 0,
          total: previous?.total ?? 0,
          message: `Connection interrupted; retrying: ${String(pollError)}`,
        }));
      }
      timer = setTimeout(poll, 1000);
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [view]);

  const handleBackToBrowse = useCallback(() => {
    setView("browse");
    setSelectedPaths(new Set());
    setImportProgress(null);
  }, []);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <p className="text-text-muted">Loading scan results...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <p className="text-red-700">Error: {error}</p>
      </div>
    );
  }

  if (!scanResult || !info || !tree) {
    return (
      <div className="max-w-4xl mx-auto p-8">
        <p className="text-text-muted">No data available</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-8">
      <header className="mb-6 border-b border-border-light pb-4">
        <h1 className="text-2xl font-semibold">artbin</h1>
        <p className="text-sm text-text-muted mt-1">
          Logged in as <strong>{info.user.name}</strong>
          {!info.user.isAdmin && " (uploads will be pending review)"}
          {" -- "}
          {info.serverUrl}
        </p>
        <p className="text-sm text-text-muted mt-1">
          {scanResult.archives.length} archives, {scanResult.looseFiles.length}{" "}
          loose files
        </p>
      </header>

      {view === "browse" && (
        <>
          <div className="flex items-center gap-4 mb-4">
            <button
              type="button"
              className="btn btn-sm"
              onClick={handleSelectAll}
            >
              Select all
            </button>
            {selectedPaths.size > 0 && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={handleClearSelection}
              >
                Clear ({selectedPaths.size})
              </button>
            )}
          </div>

          <ScanTreeView
            node={tree}
            selectedPaths={selectedPaths}
            onToggleFolder={handleToggleFolder}
            renderArchive={(archive: FoundArchive, isSelected: boolean) => (
              <ArchiveItem
                key={archive.path}
                archive={archive}
                isSelected={isSelected}
                onToggle={() => handleToggleSingle(archive.path)}
              />
            )}
          />

          {scanResult.looseFiles.length > 0 && (
            <label className="block my-4">
              <input
                type="checkbox"
                checked={includeLooseFiles}
                onChange={(event) => setIncludeLooseFiles(event.target.checked)}
              />{" "}
              Include {scanResult.looseFiles.length} loose files (preserve their
              folders)
            </label>
          )}

          <BatchControls
            selectedCount={
              selectedPaths.size +
              (includeLooseFiles ? scanResult.looseFiles.length : 0)
            }
            onClear={handleClearSelection}
          >
            {({ close }) => (
              <div>
                {!info.user.isAdmin && (
                  <p className="mb-3 text-sm text-text-muted border border-border-light p-2 bg-bg-hover">
                    You are not an admin. Uploads will be submitted for review.
                  </p>
                )}

                <DestinationPicker
                  folders={info.folders}
                  value={destinationFolder}
                  onChange={setDestinationFolder}
                />
                {!destinationFolder && (
                  <input
                    aria-label="New folder slug"
                    type="text"
                    className="w-full p-2 border border-border-light bg-white text-sm mb-3"
                    placeholder="folder-slug"
                    value={newFolderSlug}
                    onChange={(e) => setNewFolderSlug(e.target.value)}
                  />
                )}

                <div className="flex gap-2 justify-end">
                  <button type="button" className="btn" onClick={close}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => handleImport(close)}
                    disabled={!destinationFolder && !newFolderSlug}
                  >
                    Start import
                  </button>
                </div>
              </div>
            )}
          </BatchControls>
        </>
      )}

      {view === "importing" && (
        <div className="py-8">
          <h2 className="text-lg font-semibold mb-4">Importing...</h2>
          {importProgress && (
            <div>
              <p className="text-sm text-text-muted mb-2">
                {importProgress.message}
              </p>
              <progress
                aria-label={`${importProgress.phase} progress`}
                className="w-full h-4"
                max={importProgress.total || 1}
                value={
                  importProgress.total > 0 ? importProgress.current : undefined
                }
              />
              <p className="text-xs text-text-muted mt-1">
                {importProgress.phase}
                {importProgress.total > 0
                  ? ` — ${Math.floor((importProgress.current / importProgress.total) * 100)}%`
                  : ""}
              </p>
            </div>
          )}
          {!importProgress && (
            <p className="text-sm text-text-muted">Starting import...</p>
          )}
        </div>
      )}

      {view === "done" && importProgress && (
        <div className="py-8">
          <h2 className="text-lg font-semibold mb-4">
            {importProgress.status === "error"
              ? "Import failed"
              : "Import complete"}
          </h2>

          {importProgress.status === "error" && (
            <p className="text-sm text-red-700 mb-4">{importProgress.error}</p>
          )}

          {importProgress.result && (
            <div className="border border-border-light p-4 mb-4 text-sm">
              <p>
                <strong>{importProgress.result.uploaded}</strong> files uploaded
              </p>
              {importProgress.result.skipped > 0 && (
                <p>
                  <strong>{importProgress.result.skipped}</strong> already
                  existed (skipped)
                </p>
              )}
              {importProgress.result.failed > 0 && (
                <p className="text-red-700">
                  <strong>{importProgress.result.failed}</strong> failed
                </p>
              )}
              <p className="text-text-muted mt-1">
                {importProgress.result.total} total files processed
              </p>
            </div>
          )}

          <button type="button" className="btn" onClick={handleBackToBrowse}>
            Back to browse
          </button>
        </div>
      )}
    </div>
  );
}

async function readJson(response: Response) {
  if (!response.ok)
    throw new Error(
      `Request failed (${response.status}): ${await response.text()}`,
    );
  return response.json();
}
