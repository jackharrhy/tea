import {
  clientEntry,
  css,
  on,
  ref,
  type Handle,
  type SerializableProps,
} from "remix/component";

import {
  UploadClient,
  MAX_UPLOAD_BYTES,
  type ArchiveAnalysis,
} from "@tea/artbin-core/uploads";

import { routes } from "../../routes.ts";
import { ModalFrame } from "../modal.tsx";
import { Alert, Button, Disclosure, ProgressBar } from "../primitives.tsx";
import {
  buttonStyle,
  inputStyle,
  modalActionsStyle,
  modalCloseStyle,
  primaryButtonStyle,
  smallButtonStyle,
  theme,
  visuallyHiddenStyle,
} from "../styles.ts";

const destinationStyle = css({
  background: theme.color.hover,
  border: `1px solid ${theme.color.borderLight}`,
  fontSize: "0.875rem",
  marginBottom: "1rem",
  padding: "0.75rem",
});
const destinationNameStyle = css({ fontWeight: 500 });
const destinationPathStyle = css({
  color: theme.color.muted,
  fontSize: "0.75rem",
});
const uploadZoneStyle = css({
  border: `2px dashed ${theme.color.borderLight}`,
  marginBottom: "1rem",
  padding: "1.5rem",
});
const fileListHeaderStyle = css({
  alignItems: "center",
  display: "flex",
  fontSize: "0.875rem",
  fontWeight: 500,
  justifyContent: "space-between",
  marginBottom: "0.5rem",
});
const fileListItemsStyle = css({
  fontFamily: theme.font.mono,
  fontSize: "0.75rem",
  maxHeight: "200px",
  overflow: "auto",
});
const fileItemStyle = css({
  borderBottom: `1px solid ${theme.color.subtle}`,
  display: "flex",
  justifyContent: "space-between",
  paddingBlock: "0.25rem",
});
const fileNameStyle = css({
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
const fileStatusStyle = css({ flexShrink: 0, marginLeft: "0.5rem" });
const emptyZoneStyle = css({ textAlign: "center" });
const archiveNoteStyle = css({
  color: theme.color.faint,
  fontSize: "0.75rem",
  margin: "0.25rem 0 0",
});
const topSpacedButtonStyle = css({ marginTop: "0.75rem" });
const uploadButtonsStyle = css({
  display: "flex",
  gap: "0.5rem",
  justifyContent: "center",
  marginTop: "1rem",
});
const importFormStyle = css({
  borderTop: `1px solid ${theme.color.borderLight}`,
  marginTop: "1.25rem",
  paddingTop: "1.25rem",
});
const subheadingStyle = css({ fontWeight: 500, margin: "0 0 0.25rem" });
const descriptionStyle = css({
  color: theme.color.muted,
  fontSize: "0.875rem",
  margin: "0 0 0.75rem",
});
const sourceInputStyle = css({ fontFamily: theme.font.mono, width: "100%" });
const helpStyle = css({
  color: theme.color.faint,
  fontSize: "0.75rem",
  margin: "0.25rem 0 0",
});
const endActionsStyle = css({ justifyContent: "flex-end" });
const formLabelStyle = css({
  color: theme.color.muted,
  display: "block",
  fontSize: "0.75rem",
  fontWeight: 500,
  letterSpacing: "0.025em",
  marginBottom: "0.25rem",
  textTransform: "uppercase",
});
const formInputStyle = css({ marginBottom: "1rem", width: "100%" });
const locationNoteStyle = css({
  color: theme.color.faint,
  fontSize: "0.75rem",
  margin: "0 0 1rem",
});
const archiveFactsStyle = css({
  columnGap: "1rem",
  display: "grid",
  fontSize: "0.875rem",
  gridTemplateColumns: "auto 1fr",
  margin: "0 0 1rem",
  rowGap: "0.25rem",
});
const factLabelStyle = css({ color: theme.color.muted, fontWeight: 500 });
const uppercaseStyle = css({ textTransform: "uppercase" });
const disclosureSpacingStyle = css({ marginBottom: "1rem" });
const archiveFilesStyle = css({
  fontFamily: theme.font.mono,
  fontSize: "0.75rem",
  marginTop: "0.5rem",
  maxHeight: "150px",
  overflow: "auto",
});
const archiveFileStyle = css({
  borderBottom: `1px solid ${theme.color.subtle}`,
  padding: "0.25rem",
});
const progressStyle = css({ marginTop: "1rem" });

interface UploadFolder extends SerializableProps {
  id: string;
  slug: string;
  name: string;
}

interface UploadControlProps extends SerializableProps {
  currentFolder?: UploadFolder;
  isAdmin: boolean;
  label?: string;
}

interface SelectedFile {
  file: File;
  relativePath: string;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

async function hashFile(file: File): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES)
    throw new Error("Individual uploads may be at most 512 MiB");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

type View = "main" | "folder" | "archive";

const archiveExtensions = new Set(["pak", "pk3", "zip"]);

export const UploadControl = clientEntry(
  `${import.meta.url}#UploadControl`,
  function UploadControl(handle: Handle<UploadControlProps>) {
    let open = false;
    let view: View = "main";
    let files: SelectedFile[] = [];
    let fileInput: HTMLInputElement | null = null;
    let directoryInput: HTMLInputElement | null = null;
    let error: string | null = null;
    let message: string | null = null;
    let busy = false;
    let progress = { done: 0, total: 0 };
    let analysis: (ArchiveAnalysis & { uploadId: string }) | null = null;
    let archiveName = "";
    let archiveSlug = "";
    let folderName = "";
    let folderSlug = "";

    function close() {
      open = false;
      view = "main";
      files = [];
      error = null;
      message = null;
      busy = false;
      progress = { done: 0, total: 0 };
      analysis = null;
      archiveName = "";
      archiveSlug = "";
      folderName = "";
      folderSlug = "";
      handle.update();
    }

    async function analyze(file: File, signal: AbortSignal) {
      busy = true;
      error = null;
      await handle.update();
      try {
        const sha256 = await hashFile(file);
        const { uploadId, result } = await new UploadClient({
          serverUrl: location.origin,
          signal,
        }).upload(file, {
          purpose: "archive",
          path: file.name,
          sha256,
        });
        if (signal.aborted) return;
        if (result.purpose !== "archive")
          throw new Error("Invalid archive analysis response");
        analysis = { ...result.archiveAnalysis, uploadId };
        archiveName = analysis.suggestedName;
        archiveSlug = analysis.suggestedSlug;
        view = "archive";
      } catch (caught) {
        if (!signal.aborted) {
          error =
            caught instanceof Error
              ? caught.message
              : "The archive could not be analyzed.";
        }
      }
      busy = false;
      handle.update();
    }

    return () => {
      const props = handle.props;
      const currentFolder = props.currentFolder;
      const atRoot = !currentFolder;

      return (
        <>
          <button
            type="button"
            mix={[
              buttonStyle,
              primaryButtonStyle,
              on("click", () => {
                open = true;
                handle.update();
              }),
            ]}
          >
            {props.label ?? (atRoot ? "Add" : "Upload")}
          </button>
          {open ? (
            <ModalFrame
              title={
                view === "folder"
                  ? "Create folder"
                  : view === "archive"
                    ? "Archive detected"
                    : atRoot
                      ? "Add to library"
                      : props.isAdmin
                        ? `Upload to ${currentFolder.name}`
                        : `Upload to ${currentFolder.name} for review`
              }
              onDismiss={close}
              closeControl={
                <button
                  type="button"
                  aria-label="Close"
                  mix={[modalCloseStyle, on("click", close)]}
                >
                  ×
                </button>
              }
            >
              {error ? <Alert tone="danger">{error}</Alert> : null}
              {message ? <Alert tone="success">{message}</Alert> : null}

              {view === "main" ? (
                <>
                  {currentFolder ? (
                    <div mix={destinationStyle}>
                      <div mix={destinationNameStyle}>
                        Destination: {currentFolder.name}
                      </div>
                      <div mix={destinationPathStyle}>
                        /{currentFolder.slug}
                      </div>
                    </div>
                  ) : null}

                  <div mix={uploadZoneStyle}>
                    <input
                      type="file"
                      multiple
                      mix={[
                        visuallyHiddenStyle,
                        ref((element) => {
                          fileInput = element as HTMLInputElement;
                        }),
                        on("change", async (event, signal) => {
                          const selected = [
                            ...((event.currentTarget as HTMLInputElement)
                              .files ?? []),
                          ];
                          if (!selected.length) return;
                          const next = selected.map((file) => ({
                            file,
                            relativePath:
                              (file as File & { webkitRelativePath?: string })
                                .webkitRelativePath || file.name,
                            status: "pending" as const,
                          }));
                          if (
                            props.isAdmin &&
                            next.length === 1 &&
                            isArchive(next[0]!.file.name)
                          ) {
                            await analyze(next[0]!.file, signal);
                            return;
                          }
                          if (atRoot) {
                            error = props.isAdmin
                              ? "At the top level, select one PAK, PK3, or ZIP archive."
                              : "Open a folder before uploading files.";
                            handle.update();
                            return;
                          }
                          files = next;
                          error = null;
                          message = null;
                          handle.update();
                        }),
                      ]}
                    />
                    <input
                      type="file"
                      multiple
                      mix={[
                        visuallyHiddenStyle,
                        ref((element) => {
                          directoryInput = element as HTMLInputElement;
                          element.setAttribute("webkitdirectory", "");
                        }),
                        on("change", (event) => {
                          const selected = [
                            ...((event.currentTarget as HTMLInputElement)
                              .files ?? []),
                          ];
                          files = selected.map((file) => ({
                            file,
                            relativePath:
                              (file as File & { webkitRelativePath?: string })
                                .webkitRelativePath || file.name,
                            status: "pending" as const,
                          }));
                          error = null;
                          message = null;
                          handle.update();
                        }),
                      ]}
                    />

                    {files.length ? (
                      <div>
                        <div mix={fileListHeaderStyle}>
                          {files.length} file{files.length === 1 ? "" : "s"}{" "}
                          selected
                          <button
                            type="button"
                            mix={[
                              buttonStyle,
                              smallButtonStyle,
                              on("click", () => {
                                files = [];
                                handle.update();
                              }),
                            ]}
                          >
                            Clear
                          </button>
                        </div>
                        <div mix={fileListItemsStyle}>
                          {files.slice(0, 10).map((selected, index) => (
                            <div
                              key={`${selected.relativePath}-${index}`}
                              mix={fileItemStyle}
                            >
                              <span mix={fileNameStyle}>
                                {selected.relativePath}
                              </span>
                              <span mix={fileStatusStyle}>
                                {selected.status === "uploading"
                                  ? "..."
                                  : selected.status === "done"
                                    ? "✓"
                                    : selected.status === "error"
                                      ? "✗"
                                      : ""}
                              </span>
                            </div>
                          ))}
                          {files.length > 10 ? (
                            <div mix={[fileItemStyle, destinationPathStyle]}>
                              {files.length - 10} more file
                              {files.length - 10 === 1 ? "" : "s"}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <div mix={emptyZoneStyle}>
                        {atRoot && props.isAdmin ? (
                          <>
                            <p>Import an archive to create a collection.</p>
                            <p mix={archiveNoteStyle}>
                              Supports PAK, PK3, and ZIP.
                            </p>
                            <button
                              type="button"
                              mix={[
                                buttonStyle,
                                topSpacedButtonStyle,
                                on("click", () => fileInput?.click()),
                              ]}
                            >
                              Select archive
                            </button>
                          </>
                        ) : atRoot ? (
                          <p>Open a folder before uploading files.</p>
                        ) : (
                          <>
                            <p>Select files or a folder to upload.</p>
                            <div mix={uploadButtonsStyle}>
                              <button
                                type="button"
                                mix={[
                                  buttonStyle,
                                  on("click", () => fileInput?.click()),
                                ]}
                              >
                                Select files
                              </button>
                              <button
                                type="button"
                                mix={[
                                  buttonStyle,
                                  on("click", () => directoryInput?.click()),
                                ]}
                              >
                                Select folder
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  <div mix={modalActionsStyle}>
                    {files.length && currentFolder ? (
                      <button
                        type="button"
                        disabled={busy}
                        mix={[
                          buttonStyle,
                          primaryButtonStyle,
                          on("click", async (_event, signal) => {
                            busy = true;
                            error = null;
                            message = null;
                            progress = { done: 0, total: files.length };
                            const batchId = crypto.randomUUID();
                            const client = new UploadClient({
                              serverUrl: location.origin,
                              signal,
                            });
                            let successes = 0;
                            for (let index = 0; index < files.length; index++) {
                              if (signal.aborted) return;
                              const selected = files[index]!;
                              selected.status = "uploading";
                              await handle.update();
                              try {
                                const { result } = await client.upload(
                                  selected.file,
                                  {
                                    purpose: "file",
                                    parentFolder: currentFolder.slug,
                                    path: selected.relativePath,
                                    batchId,
                                    sha256: await hashFile(selected.file),
                                  },
                                );
                                if (result.purpose !== "file")
                                  throw new Error("Invalid file response");
                                selected.status = "done";
                                successes++;
                                if (result.pendingUpload)
                                  message =
                                    "Upload complete. An admin will review your submission.";
                              } catch (caught) {
                                if (signal.aborted) return;
                                selected.status = "error";
                                selected.error =
                                  caught instanceof Error
                                    ? caught.message
                                    : "Upload failed.";
                              }
                              progress.done = index + 1;
                              await handle.update();
                            }
                            if (successes && props.isAdmin) {
                              try {
                                await client.finalize(currentFolder.slug);
                              } catch (caught) {
                                error =
                                  caught instanceof Error
                                    ? caught.message
                                    : "Folder previews failed";
                              }
                            }
                            busy = false;
                            const firstError = files.find(
                              (selected) => selected.error,
                            )?.error;
                            if (firstError) error = firstError;
                            await handle.update();
                            if (
                              successes === files.length &&
                              props.isAdmin &&
                              !error
                            ) {
                              close();
                              location.reload();
                            }
                          }),
                        ]}
                      >
                        {busy
                          ? "Uploading..."
                          : `Upload ${files.length} file${files.length === 1 ? "" : "s"}`}
                      </button>
                    ) : null}
                    {props.isAdmin ? (
                      <button
                        type="button"
                        mix={[
                          buttonStyle,
                          on("click", () => {
                            view = "folder";
                            error = null;
                            handle.update();
                          }),
                        ]}
                      >
                        Create folder
                      </button>
                    ) : null}
                  </div>

                  {props.isAdmin ? (
                    <form
                      mix={[
                        importFormStyle,
                        on("submit", async (event, signal) => {
                          event.preventDefault();
                          busy = true;
                          error = null;
                          message = null;
                          await handle.update();
                          const form = new FormData(
                            event.currentTarget as HTMLFormElement,
                          );
                          if (currentFolder)
                            form.set("targetFolderId", currentFolder.id);
                          try {
                            const response = await fetch(
                              routes.api.import.href(),
                              {
                                method: "POST",
                                body: form,
                                signal,
                              },
                            );
                            const result = (await response.json()) as {
                              error?: string;
                              count?: number;
                            };
                            if (!response.ok || result.error)
                              error =
                                result.error ?? "Import could not be queued.";
                            else
                              message = `Queued ${result.count ?? 0} import${result.count === 1 ? "" : "s"}.`;
                          } catch (caught) {
                            if (!signal.aborted)
                              error =
                                caught instanceof Error
                                  ? caught.message
                                  : "Import failed.";
                          }
                          busy = false;
                          handle.update();
                        }),
                      ]}
                    >
                      <h3 mix={subheadingStyle}>Import from site</h3>
                      <p mix={descriptionStyle}>
                        Paste GameBanana or SCMapDB pages, or direct HTTPS
                        archive links.
                      </p>
                      <textarea
                        name="sourceUrls"
                        rows={4}
                        required
                        mix={[inputStyle, sourceInputStyle]}
                        placeholder={
                          "https://gamebanana.com/mods/140244\nhttps://scmapdb.wikidot.com/map:decay"
                        }
                      />
                      <p mix={helpStyle}>
                        One URL per line, up to 20. Collections are created{" "}
                        {currentFolder
                          ? `inside ${currentFolder.name}`
                          : "at the top level"}
                        .
                      </p>
                      <div mix={[modalActionsStyle, endActionsStyle]}>
                        <button
                          type="submit"
                          mix={[buttonStyle, primaryButtonStyle]}
                          disabled={busy}
                        >
                          {busy ? "Adding to queue..." : "Import"}
                        </button>
                      </div>
                    </form>
                  ) : null}
                </>
              ) : null}

              {view === "folder" && props.isAdmin ? (
                <form
                  mix={on("submit", async (event, signal) => {
                    event.preventDefault();
                    busy = true;
                    error = null;
                    await handle.update();
                    try {
                      const response = await fetch(routes.api.folder.href(), {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          name: folderName,
                          slug: folderSlug,
                          parentId: currentFolder?.id ?? null,
                        }),
                        signal,
                      });
                      const result = (await response.json()) as {
                        error?: string;
                      };
                      if (!response.ok || result.error)
                        error = result.error ?? "Folder creation failed.";
                      else location.reload();
                    } catch (caught) {
                      if (!signal.aborted)
                        error =
                          caught instanceof Error
                            ? caught.message
                            : "Folder creation failed.";
                    }
                    busy = false;
                    handle.update();
                  })}
                >
                  <label mix={formLabelStyle}>Folder name</label>
                  <input
                    name="name"
                    value={folderName}
                    required
                    mix={[
                      inputStyle,
                      formInputStyle,
                      on("input", (event) => {
                        folderName = (event.currentTarget as HTMLInputElement)
                          .value;
                        folderSlug = slugify(folderName);
                        handle.update();
                      }),
                    ]}
                  />
                  <label mix={formLabelStyle}>
                    Folder URL slug (from the folder name)
                  </label>
                  <input
                    name="slug"
                    value={folderSlug}
                    pattern="[a-z0-9\-]+"
                    required
                    mix={[
                      inputStyle,
                      formInputStyle,
                      on("input", (event) => {
                        folderSlug = (event.currentTarget as HTMLInputElement)
                          .value;
                      }),
                    ]}
                  />
                  {currentFolder ? (
                    <p mix={locationNoteStyle}>
                      New folder location: {currentFolder.name}
                    </p>
                  ) : null}
                  <div mix={modalActionsStyle}>
                    <Button type="submit" variant="primary" disabled={busy}>
                      {busy ? "Creating..." : "Create folder"}
                    </Button>
                    <button
                      type="button"
                      mix={[
                        buttonStyle,
                        on("click", () => {
                          view = "main";
                          handle.update();
                        }),
                      ]}
                    >
                      Back
                    </button>
                  </div>
                </form>
              ) : null}

              {view === "archive" && props.isAdmin && analysis ? (
                <>
                  <dl mix={archiveFactsStyle}>
                    <dt mix={factLabelStyle}>File</dt>
                    <dd>{analysis.originalName}</dd>
                    <dt mix={factLabelStyle}>Type</dt>
                    <dd mix={uppercaseStyle}>{analysis.archiveType}</dd>
                    <dt mix={factLabelStyle}>Files</dt>
                    <dd>{analysis.totalFiles}</dd>
                    <dt mix={factLabelStyle}>Directories</dt>
                    <dd>{analysis.totalDirs}</dd>
                  </dl>
                  <div mix={disclosureSpacingStyle}>
                    <Disclosure summary="Files in archive">
                      <div mix={archiveFilesStyle}>
                        {analysis.sampleFiles.map((name) => (
                          <div key={name} mix={archiveFileStyle}>
                            {name}
                          </div>
                        ))}
                      </div>
                    </Disclosure>
                  </div>
                  <label mix={formLabelStyle}>Folder name</label>
                  <input
                    value={archiveName}
                    required
                    mix={[
                      inputStyle,
                      formInputStyle,
                      on("input", (event) => {
                        archiveName = (event.currentTarget as HTMLInputElement)
                          .value;
                        archiveSlug = slugify(archiveName);
                        handle.update();
                      }),
                    ]}
                  />
                  <label mix={formLabelStyle}>
                    Folder URL slug (from the folder name)
                  </label>
                  <input
                    value={archiveSlug}
                    pattern="[a-z0-9\-]+"
                    required
                    mix={[
                      inputStyle,
                      formInputStyle,
                      on("input", (event) => {
                        archiveSlug = (event.currentTarget as HTMLInputElement)
                          .value;
                      }),
                    ]}
                  />
                  <div mix={modalActionsStyle}>
                    <button
                      type="button"
                      disabled={busy}
                      mix={[
                        buttonStyle,
                        primaryButtonStyle,
                        on("click", async (_event, signal) => {
                          if (!analysis) return;
                          busy = true;
                          error = null;
                          await handle.update();
                          try {
                            const response = await fetch(
                              routes.api.extractUpload.href({
                                uploadId: analysis.uploadId,
                              }),
                              {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  folderName: archiveName,
                                  folderSlug: archiveSlug,
                                  ...(currentFolder
                                    ? { parentFolderId: currentFolder.id }
                                    : {}),
                                }),
                                signal,
                              },
                            );
                            if (!response.ok) error = await response.text();
                            else {
                              close();
                              location.reload();
                            }
                          } catch (caught) {
                            if (!signal.aborted)
                              error =
                                caught instanceof Error
                                  ? caught.message
                                  : "Extraction failed.";
                          }
                          busy = false;
                          handle.update();
                        }),
                      ]}
                    >
                      {busy ? "Starting..." : "Extract archive"}
                    </button>
                    <button
                      type="button"
                      mix={[
                        buttonStyle,
                        on("click", () => {
                          analysis = null;
                          view = "main";
                          handle.update();
                        }),
                      ]}
                    >
                      Back
                    </button>
                  </div>
                </>
              ) : null}

              {busy && progress.total ? (
                <div mix={progressStyle}>
                  <ProgressBar
                    value={(progress.done / progress.total) * 100}
                    label="Uploading files"
                    detail={`${progress.done} / ${progress.total}`}
                  />
                </div>
              ) : null}
            </ModalFrame>
          ) : null}
        </>
      );
    };
  },
);

function isArchive(name: string): boolean {
  const extension = name.split(".").pop()?.toLowerCase();
  return !!extension && archiveExtensions.has(extension);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
