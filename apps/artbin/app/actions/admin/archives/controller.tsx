import { desc, eq } from "drizzle-orm";
import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";
import { css, type Handle } from "remix/component";

import { jobs } from "#db";
import { db } from "#db/connection.server";
import { createJob } from "#lib/jobs.server";
import type { FoundArchive } from "#lib/jobs/scan-archives-job.server";

import { requireAdmin } from "../../../middleware/auth.ts";
import { routes } from "../../../routes.ts";
import { AdminPage } from "../../../ui/admin-page.tsx";
import { formatSize } from "../../../ui/file-collection.tsx";
import { AutoRefresh } from "../../../ui/public/auto-refresh.tsx";
import {
  Alert,
  Badge,
  Button,
  CheckboxField,
  EmptyState,
  FormField,
  Panel,
  ProgressBar,
  SectionHeader,
  TextInput,
} from "../../../ui/primitives.tsx";
import { theme } from "../../../ui/styles.ts";

const introStyle = css({ color: theme.color.muted, margin: "0 0 1.5rem" });
const scanCardStyle = css({ marginBottom: "1.5rem" });
const scanRowStyle = css({
  alignItems: "center",
  display: "flex",
  gap: "1rem",
  justifyContent: "space-between",
});
const scanNoteStyle = css({
  color: theme.color.muted,
  fontSize: "0.875rem",
  margin: 0,
});
const progressStyle = css({ marginTop: "1rem" });
const resultsNoteStyle = css({
  color: theme.color.muted,
  fontSize: "0.875rem",
  margin: "0 0 0.75rem",
});
const listStyle = css({
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
});
const batchStyle = css({ marginBottom: "1.5rem" });
const descriptionStyle = css({
  color: theme.color.muted,
  fontSize: "0.875rem",
  margin: "0 0 0.75rem",
});
const archivePickerStyle = css({
  border: `1px solid ${theme.color.borderLight}`,
  marginBottom: "1rem",
  maxHeight: "16rem",
  overflow: "auto",
  padding: "0.5rem",
});
const pathStyle = css({
  overflowWrap: "anywhere",
  fontFamily: theme.font.mono,
});
const twoColumnStyle = css({
  display: "grid",
  gap: "0.75rem",
  gridTemplateColumns: "repeat(2, 1fr)",
  "@media (max-width: 640px)": { gridTemplateColumns: "1fr" },
});
const submitStyle = css({ marginTop: "1rem" });
const archiveCardStyle = css({ marginBottom: "0.75rem" });
const archiveHeaderStyle = css({
  display: "flex",
  gap: "0.75rem",
  justifyContent: "space-between",
  marginBottom: "0.75rem",
});
const minWidthStyle = css({ minWidth: 0 });
const archiveNameStyle = css({ overflowWrap: "anywhere" });
const archivePathStyle = css({
  color: theme.color.muted,
  fontFamily: theme.font.mono,
  fontSize: "0.75rem",
  margin: 0,
  overflowWrap: "anywhere",
});
const archiveFormStyle = css({
  alignItems: "end",
  display: "grid",
  gap: "0.75rem",
  gridTemplateColumns: "1fr 1fr auto",
  "@media (max-width: 640px)": { gridTemplateColumns: "1fr" },
});

export default createController(routes.admin.archives, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      if (!context.user) return redirect(routes.login.href(), 303);
      const recentScan = await db.query.jobs.findFirst({
        where: eq(jobs.type, "scan-archives"),
        orderBy: [desc(jobs.createdAt)],
      });
      let archives: FoundArchive[] = [];
      if (recentScan?.status === "completed" && recentScan.output) {
        try {
          const output = JSON.parse(recentScan.output) as {
            archives?: FoundArchive[];
          };
          if (Array.isArray(output.archives)) archives = output.archives;
        } catch {
          // A malformed old scan should not prevent a new scan.
        }
      }
      const scanning =
        recentScan?.status === "pending" || recentScan?.status === "running";
      const notice = new URL(context.request.url).searchParams.get("notice");

      return context.render(
        <AdminPage user={context.user} active="archives" title="Local archives">
          <AutoRefresh active={scanning} />
          <p mix={introStyle}>
            Scan this computer for PAK, PK3, WAD, ZIP, and BSP files, then
            import selected assets.
          </p>
          {notice ? <Alert tone="success">{notice}</Alert> : null}
          <section mix={scanCardStyle}>
            <Panel>
              <div mix={scanRowStyle}>
                <div>
                  <strong>Scan home directory</strong>
                  <p mix={scanNoteStyle}>
                    Scan settings control game directories and ignored paths.
                  </p>
                </div>
                <form
                  method="post"
                  action={routes.admin.archives.action.href()}
                >
                  <Button
                    type="submit"
                    name="intent"
                    value="scan"
                    variant="primary"
                    disabled={scanning}
                  >
                    {scanning ? "Scan running" : "Scan"}
                  </Button>
                </form>
              </div>
              {scanning ? (
                <div mix={progressStyle}>
                  <ProgressBar
                    value={recentScan?.progress ?? 0}
                    label={recentScan?.progressMessage ?? "Starting scan"}
                  />
                </div>
              ) : null}
            </Panel>
          </section>

          {archives.length ? (
            <>
              <BatchArchiveForm archives={archives} />
              <p mix={resultsNoteStyle}>
                Found {archives.length} archive
                {archives.length === 1 ? "" : "s"}. Each item can also be
                imported into its own folder.
              </p>
              <div mix={listStyle}>
                {archives.map((archive) => (
                  <ArchiveCard key={archive.path} archive={archive} />
                ))}
              </div>
            </>
          ) : recentScan?.status === "completed" ? (
            <EmptyState
              title="No game archives were found"
              description="Adjust the scan settings or choose another location."
            />
          ) : !recentScan ? (
            <EmptyState
              title="No scan results yet"
              description="Run a scan to find supported archives on this computer."
            />
          ) : null}
        </AdminPage>,
      );
    },

    async action(context) {
      if (!context.user) return new Response("Unauthorized", { status: 401 });
      const form = await context.request.formData();
      const intent = text(form.get("intent"));

      if (intent === "scan") {
        await createJob({
          type: "scan-archives",
          input: {},
          userId: context.user.id,
        });
        return redirect(withNotice("Archive scan queued."), 303);
      }

      const folderName = text(form.get("folderName")).trim();
      const folderSlug = slug(text(form.get("folderSlug")));
      if (!folderName || !folderSlug) {
        return new Response("A valid folder name and slug are required", {
          status: 400,
        });
      }

      if (intent === "import-archive") {
        const archivePath = text(form.get("archivePath"));
        const archiveType = text(form.get("archiveType"));
        if (!archivePath)
          return new Response("Archive path is required", { status: 400 });
        if (archiveType === "bsp") {
          await createJob({
            type: "extract-bsp",
            input: {
              bspPath: archivePath,
              targetFolderSlug: folderSlug,
              targetFolderName: folderName,
              userId: context.user.id,
            },
            userId: context.user.id,
          });
        } else {
          await createJob({
            type: "extract-archive",
            input: {
              tempFile: archivePath,
              originalName: archivePath.split("/").pop() || "archive",
              targetFolderSlug: folderSlug,
              targetFolderName: folderName,
              userId: context.user.id,
              skipTempCleanup: true,
            },
            userId: context.user.id,
          });
        }
        return redirect(
          withNotice(`Import queued for ${archivePath.split("/").pop()}.`),
          303,
        );
      }

      if (intent === "batch-import") {
        const selected = form
          .getAll("archivePath")
          .filter(
            (value): value is string =>
              typeof value === "string" && value.length > 0,
          );
        if (!selected.length)
          return new Response("Select at least one archive", { status: 400 });
        const bspPaths = selected.filter((path) =>
          path.toLowerCase().endsWith(".bsp"),
        );
        const archivePaths = selected.filter(
          (path) => !path.toLowerCase().endsWith(".bsp"),
        );

        if (archivePaths.length) {
          await createJob({
            type: "batch-extract-archive",
            input: {
              parentFolderSlug: folderSlug,
              parentFolderName: folderName,
              archives: archivePaths.map((path) => ({
                path,
                subfolderSlug: slug(
                  path
                    .split("/")
                    .pop()
                    ?.replace(/\.[^.]+$/, "") || "archive",
                ),
              })),
              userId: context.user.id,
            },
            userId: context.user.id,
          });
        }
        if (bspPaths.length) {
          await createJob({
            type: "batch-extract-bsp",
            input: {
              parentFolderSlug: folderSlug,
              parentFolderName: folderName,
              bspFiles: bspPaths.map((path) => ({
                path,
                subfolderSlug: slug(
                  path
                    .split("/")
                    .pop()
                    ?.replace(/\.[^.]+$/, "") || "bsp",
                ),
              })),
              userId: context.user.id,
            },
            userId: context.user.id,
          });
        }
        return redirect(
          withNotice(
            `Queued ${selected.length} item${selected.length === 1 ? "" : "s"} for ${folderName}.`,
          ),
          303,
        );
      }

      return new Response("Unknown archive action", { status: 400 });
    },
  },
});

function BatchArchiveForm(handle: Handle<{ archives: FoundArchive[] }>) {
  return () => (
    <form
      method="post"
      action={routes.admin.archives.action.href()}
      mix={batchStyle}
    >
      <Panel>
        <SectionHeader title="Batch import" />
        <p mix={descriptionStyle}>
          Select files and import each one as a subfolder of a new collection.
        </p>
        <div mix={archivePickerStyle}>
          {handle.props.archives.map((archive) => (
            <CheckboxField
              key={archive.path}
              name="archivePath"
              value={archive.path}
            >
              <span mix={pathStyle}>{archive.path}</span>
            </CheckboxField>
          ))}
        </div>
        <div mix={twoColumnStyle}>
          <FormField
            label="Parent folder name"
            htmlFor="batch-folder-name"
            required
          >
            <TextInput
              id="batch-folder-name"
              name="folderName"
              required
              fullWidth
            />
          </FormField>
          <FormField label="Folder slug" htmlFor="batch-folder-slug" required>
            <TextInput
              id="batch-folder-slug"
              name="folderSlug"
              pattern="[a-z0-9\-]+"
              required
              fullWidth
              mono
            />
          </FormField>
        </div>
        <div mix={submitStyle}>
          <Button
            type="submit"
            name="intent"
            value="batch-import"
            variant="primary"
          >
            Import selected
          </Button>
        </div>
      </Panel>
    </form>
  );
}

function ArchiveCard(handle: Handle<{ archive: FoundArchive }>) {
  return () => {
    const archive = handle.props.archive;
    const defaultName = archive.gameDir
      ? `${archive.gameDir} - ${archive.name.replace(/\.[^.]+$/, "")}`
      : archive.name.replace(/\.[^.]+$/, "");
    const fieldPrefix = `archive-${encodeURIComponent(archive.path)}`;
    return (
      <section mix={archiveCardStyle}>
        <Panel>
          <div mix={archiveHeaderStyle}>
            <div mix={minWidthStyle}>
              <strong mix={archiveNameStyle}>{archive.name}</strong>
              <p mix={archivePathStyle}>{archive.path}</p>
            </div>
            <Badge>
              {archive.type.toUpperCase()} · {formatSize(archive.size)}
            </Badge>
          </div>
          <form
            method="post"
            action={routes.admin.archives.action.href()}
            mix={archiveFormStyle}
          >
            <input type="hidden" name="archivePath" value={archive.path} />
            <input type="hidden" name="archiveType" value={archive.type} />
            <FormField label="Folder name" htmlFor={`${fieldPrefix}-name`}>
              <TextInput
                id={`${fieldPrefix}-name`}
                name="folderName"
                value={defaultName}
                required
                fullWidth
              />
            </FormField>
            <FormField label="Folder slug" htmlFor={`${fieldPrefix}-slug`}>
              <TextInput
                id={`${fieldPrefix}-slug`}
                name="folderSlug"
                value={slug(defaultName)}
                pattern="[a-z0-9\-]+"
                required
                fullWidth
                mono
              />
            </FormField>
            <Button
              type="submit"
              name="intent"
              value="import-archive"
              variant="primary"
            >
              Import
            </Button>
          </form>
        </Panel>
      </section>
    );
  };
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function withNotice(notice: string): string {
  const url = new URL(
    routes.admin.archives.index.href(),
    "http://artbin.local",
  );
  url.searchParams.set("notice", notice);
  return `${url.pathname}${url.search}`;
}
