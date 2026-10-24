import { existsSync } from "node:fs";
import { readdir, unlink } from "node:fs/promises";
import { join, relative } from "node:path";

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";
import { css, type Handle } from "remix/component";

import { files, folders } from "#db";
import { db } from "#db/connection.server";
import {
  adoptFile,
  deleteFile,
  deleteFileRecord,
  deleteFolder,
  finalizeFolders,
  getFilePath,
  getOrCreateFolder,
  ROOT_FOLDER,
  UPLOADS_DIR,
} from "#lib/files.server";
import { createJob } from "#lib/jobs.server";

import { requireAdmin } from "../../../middleware/auth.ts";
import { routes } from "../../../routes.ts";
import { AdminPage } from "../../../ui/admin-page.tsx";
import {
  Alert,
  Button,
  ButtonLink,
  Panel,
  SectionHeader,
} from "../../../ui/primitives.tsx";
import { theme } from "../../../ui/styles.ts";

const scanActionStyle = css({ marginBottom: "1.5rem" });
const scanIntroStyle = css({
  color: theme.color.muted,
  fontSize: "0.875rem",
  margin: "0 0 2rem",
});
const cleanupListStyle = css({
  display: "flex",
  flexDirection: "column",
  gap: "0.75rem",
  marginBottom: "2rem",
});
const cleanupRowStyle = css({
  alignItems: "center",
  display: "flex",
  gap: "0.75rem",
  justifyContent: "space-between",
});
const smallTextStyle = css({ fontSize: "0.875rem" });
const hashSectionStyle = css({
  borderTop: `1px solid ${theme.color.borderLight}`,
  marginTop: "2rem",
  paddingTop: "1.5rem",
});
const statsRowStyle = css({
  alignItems: "center",
  display: "flex",
  justifyContent: "space-between",
  marginBottom: "0.75rem",
});
const missingStyle = css({ color: theme.color.faint, marginLeft: "0.5rem" });
const duplicateTitleStyle = css({ marginTop: "1rem" });
const duplicateListStyle = css({
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
});
const hashStyle = css({
  color: theme.color.faint,
  fontFamily: theme.font.mono,
  fontSize: "0.75rem",
  margin: "0 0 0.5rem",
});
const fileListStyle = css({
  fontSize: "0.875rem",
  listStyle: "none",
  margin: 0,
  padding: 0,
});
const fileRowStyle = css({
  alignItems: "center",
  display: "flex",
  gap: "0.5rem",
  justifyContent: "space-between",
  paddingBlock: "0.125rem",
});
const filePathStyle = css({
  color: theme.color.muted,
  fontFamily: theme.font.mono,
  fontSize: "0.75rem",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});
const noShrinkStyle = css({ flexShrink: 0 });
const tinyButtonStyle = css({ fontSize: "0.75rem" });

interface ScanResults {
  orphanedFiles: string[];
  missingFiles: Array<{ id: string; path: string }>;
  staleRejected: Array<{ id: string; path: string }>;
  emptyInboxSessions: Array<{ id: string; slug: string }>;
}

interface DuplicateGroup {
  sha256: string;
  count: number;
  files: Array<{
    id: string;
    path: string;
    name: string;
    size: number;
    folderId: string;
  }>;
}

export default createController(routes.admin.orphans, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      if (!context.user) return redirect(routes.login.href(), 303);
      const url = new URL(context.request.url);
      const scanResults =
        url.searchParams.get("scan") === "true" ? await performScan() : null;
      const [hashStats] = await db
        .select({
          total: sql<number>`count(*)`,
          hashed: sql<number>`count(${files.sha256})`,
        })
        .from(files);
      const groups = await db
        .select({ sha256: files.sha256, count: sql<number>`count(*)` })
        .from(files)
        .where(isNotNull(files.sha256))
        .groupBy(files.sha256)
        .having(sql`count(*) > 1`)
        .orderBy(sql`count(*) desc`)
        .limit(50);
      const duplicates: DuplicateGroup[] = [];
      for (const group of groups) {
        if (!group.sha256) continue;
        duplicates.push({
          sha256: group.sha256,
          count: group.count,
          files: await db
            .select({
              id: files.id,
              path: files.path,
              name: files.name,
              size: files.size,
              folderId: files.folderId,
            })
            .from(files)
            .where(eq(files.sha256, group.sha256)),
        });
      }
      const notice = url.searchParams.get("notice");

      return context.render(
        <AdminPage user={context.user} active="orphans" title="Orphan finder">
          {notice ? <Alert tone="success">{notice}</Alert> : null}
          <div mix={scanActionStyle}>
            <ButtonLink
              href={`${routes.admin.orphans.index.href()}?scan=true`}
              variant="primary"
            >
              Scan uploads
            </ButtonLink>
          </div>
          {!scanResults ? (
            <p mix={scanIntroStyle}>
              Scan the uploads directory and compare it with the database.
            </p>
          ) : (
            <ScanResultsPanel results={scanResults} />
          )}
          <HashPanel
            stats={{
              total: hashStats?.total ?? 0,
              hashed: hashStats?.hashed ?? 0,
            }}
            duplicates={duplicates}
          />
        </AdminPage>,
      );
    },

    async action(context) {
      if (!context.user) return new Response("Unauthorized", { status: 401 });
      const form = await context.request.formData();
      const intent = text(form.get("intent"));
      let deleted = 0;

      if (intent === "delete-orphans") {
        const paths = parseArray<string>(form.get("paths"));
        for (const path of paths) {
          let fullPath: string;
          try {
            fullPath = getFilePath(path);
          } catch {
            return new Response("Invalid orphan path", { status: 400 });
          }
          try {
            await unlink(fullPath);
            deleted++;
          } catch {
            // A concurrently removed orphan is already clean.
          }
        }
      } else if (intent === "adopt-orphans") {
        const requested = parseArray<string>(form.get("paths"));
        const currentOrphans = new Set((await performScan()).orphanedFiles);
        const paths = requested.filter((path) => currentOrphans.has(path));
        const affectedFolders = new Set<string>();
        for (const path of paths) {
          const folderId = await ensureFolderTreeForFile(path);
          if (!folderId) continue;
          const adopted = await adoptFile({
            path,
            folderId,
            source: "filesystem-adopted",
            uploaderId: context.user.id,
          });
          if (adopted.isErr()) {
            return new Response(
              `Unable to adopt ${path}: ${adopted.error.message}`,
              {
                status: 400,
              },
            );
          }
          affectedFolders.add(folderId);
          deleted++;
        }
        await finalizeFolders([...affectedFolders]);
        return redirect(
          withNotice(`Adopted ${deleted} file${deleted === 1 ? "" : "s"}.`),
          303,
        );
      } else if (intent === "delete-missing") {
        for (const id of parseArray<string>(form.get("ids"))) {
          if ((await deleteFileRecord(id)).isOk()) deleted++;
        }
      } else if (intent === "cleanup-rejected") {
        const items = parseArray<{ id: string; path: string }>(
          form.get("items"),
        );
        for (const item of items) {
          try {
            await deleteFile(item.path);
          } catch {
            // The DB record still needs cleanup when the disk file is already gone.
          }
          if ((await deleteFileRecord(item.id)).isOk()) deleted++;
        }
      } else if (intent === "cleanup-sessions") {
        const sessions = parseArray<{ id: string; slug: string }>(
          form.get("sessions"),
        );
        for (const session of sessions) {
          try {
            await deleteFolder(session.slug);
          } catch {
            // Continue with the stale database record.
          }
          try {
            await db.delete(folders).where(eq(folders.id, session.id));
            deleted++;
          } catch (error) {
            console.error(
              "Unable to delete empty inbox session",
              session.id,
              error,
            );
          }
        }
      } else if (intent === "delete-duplicates") {
        const keepId = text(form.get("keepId"));
        for (const id of parseArray<string>(form.get("deleteIds"))) {
          if (id === keepId) continue;
          const file = await db.query.files.findFirst({
            where: eq(files.id, id),
            columns: { path: true },
          });
          if (!file) continue;
          try {
            await deleteFile(file.path);
          } catch {
            // The record can still be removed when its file is missing.
          }
          if ((await deleteFileRecord(id)).isOk()) deleted++;
        }
      } else if (intent === "backfill-hashes") {
        await createJob({
          type: "backfill-hashes",
          input: {},
          userId: context.user.id,
        });
        return redirect(withNotice("Hash backfill queued."), 303);
      } else {
        return new Response("Unknown orphan cleanup action", { status: 400 });
      }

      return redirect(
        withNotice(`Cleaned up ${deleted} item${deleted === 1 ? "" : "s"}.`),
        303,
      );
    },
  },
});

function ScanResultsPanel(handle: Handle<{ results: ScanResults }>) {
  return () => {
    const results = handle.props.results;
    const allClean =
      results.orphanedFiles.length === 0 &&
      results.missingFiles.length === 0 &&
      results.staleRejected.length === 0 &&
      results.emptyInboxSessions.length === 0;
    if (allClean) return <Alert tone="success">Everything looks clean.</Alert>;
    return (
      <div mix={cleanupListStyle}>
        <CleanupRow
          count={results.orphanedFiles.length}
          label="orphaned file on disk"
          button="Delete orphan files"
          intent="delete-orphans"
          field="paths"
          value={JSON.stringify(results.orphanedFiles)}
          secondary={{ button: "Adopt orphan files", intent: "adopt-orphans" }}
        />
        <CleanupRow
          count={results.missingFiles.length}
          label="missing file in the database"
          button="Delete records"
          intent="delete-missing"
          field="ids"
          value={JSON.stringify(results.missingFiles.map((file) => file.id))}
        />
        <CleanupRow
          count={results.staleRejected.length}
          label="stale rejected file"
          button="Clean up"
          intent="cleanup-rejected"
          field="items"
          value={JSON.stringify(results.staleRejected)}
        />
        <CleanupRow
          count={results.emptyInboxSessions.length}
          label="empty inbox session"
          button="Clean up"
          intent="cleanup-sessions"
          field="sessions"
          value={JSON.stringify(results.emptyInboxSessions)}
        />
      </div>
    );
  };
}

function CleanupRow(
  handle: Handle<{
    count: number;
    label: string;
    button: string;
    intent: string;
    field: string;
    value: string;
    secondary?: { button: string; intent: string };
  }>,
) {
  return () => (
    <Panel>
      <div mix={cleanupRowStyle}>
        <span mix={smallTextStyle}>
          <strong>{handle.props.count}</strong> {handle.props.label}
          {handle.props.count === 1 ? "" : "s"}
        </span>
        {handle.props.count ? (
          <div mix={cleanupRowStyle}>
            {handle.props.secondary ? (
              <form method="post" action={routes.admin.orphans.action.href()}>
                <input
                  type="hidden"
                  name="intent"
                  value={handle.props.secondary.intent}
                />
                <input
                  type="hidden"
                  name={handle.props.field}
                  value={handle.props.value}
                />
                <Button type="submit" variant="primary" size="small">
                  {handle.props.secondary.button}
                </Button>
              </form>
            ) : null}
            <form method="post" action={routes.admin.orphans.action.href()}>
              <input type="hidden" name="intent" value={handle.props.intent} />
              <input
                type="hidden"
                name={handle.props.field}
                value={handle.props.value}
              />
              <Button type="submit" variant="danger" size="small">
                {handle.props.button}
              </Button>
            </form>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

async function ensureFolderTreeForFile(
  filePath: string,
): Promise<string | null> {
  const directory = filePath.replaceAll("\\", "/").split("/").slice(0, -1);
  if (directory.length === 0) return null;
  let parentId: typeof ROOT_FOLDER | string = ROOT_FOLDER;
  const slugs: string[] = [];
  for (const segment of directory) {
    slugs.push(segment);
    parentId = await getOrCreateFolder(slugs.join("/"), segment, parentId);
  }
  return typeof parentId === "string" ? parentId : null;
}

function HashPanel(
  handle: Handle<{
    stats: { total: number; hashed: number };
    duplicates: DuplicateGroup[];
  }>,
) {
  return () => {
    const { stats, duplicates } = handle.props;
    return (
      <section mix={hashSectionStyle}>
        <SectionHeader title="File hashes" />
        <Panel>
          <div mix={statsRowStyle}>
            <span mix={smallTextStyle}>
              <strong>{stats.hashed}</strong> / {stats.total}{" "}
              {stats.total === 1 ? "file" : "files"} hashed
              {stats.hashed < stats.total ? (
                <span mix={missingStyle}>
                  ({stats.total - stats.hashed} missing)
                </span>
              ) : null}
            </span>
            {stats.hashed < stats.total ? (
              <form method="post" action={routes.admin.orphans.action.href()}>
                <Button
                  type="submit"
                  name="intent"
                  value="backfill-hashes"
                  variant="primary"
                  size="small"
                >
                  Backfill hashes
                </Button>
              </form>
            ) : null}
          </div>
        </Panel>
        {duplicates.length ? (
          <>
            <div mix={duplicateTitleStyle}>
              <SectionHeader
                title={`Duplicates (${duplicates.length} group${duplicates.length === 1 ? "" : "s"})`}
              />
            </div>
            <div mix={duplicateListStyle}>
              {duplicates.map((group) => (
                <DuplicateCard key={group.sha256} group={group} />
              ))}
            </div>
          </>
        ) : stats.hashed ? (
          <p mix={[smallTextStyle, scanIntroStyle]}>
            No duplicate files found.
          </p>
        ) : null}
      </section>
    );
  };
}

function DuplicateCard(handle: Handle<{ group: DuplicateGroup }>) {
  return () => {
    const group = handle.props.group;
    return (
      <Panel>
        <p mix={hashStyle}>
          sha256: {group.sha256.slice(0, 16)}... ({group.count} copies)
        </p>
        <ul mix={fileListStyle}>
          {group.files.map((file) => (
            <li key={file.id} mix={fileRowStyle}>
              <span mix={filePathStyle}>{file.path}</span>
              <form
                method="post"
                action={routes.admin.orphans.action.href()}
                mix={noShrinkStyle}
              >
                <input type="hidden" name="intent" value="delete-duplicates" />
                <input type="hidden" name="keepId" value={file.id} />
                <input
                  type="hidden"
                  name="deleteIds"
                  value={JSON.stringify(
                    group.files
                      .filter((other) => other.id !== file.id)
                      .map((other) => other.id),
                  )}
                />
                <span mix={tinyButtonStyle}>
                  <Button type="submit" size="small">
                    Keep this copy
                  </Button>
                </span>
              </form>
            </li>
          ))}
        </ul>
      </Panel>
    );
  };
}

async function walkDirectory(
  directory: string,
  base: string,
): Promise<string[]> {
  const paths: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory())
      paths.push(...(await walkDirectory(fullPath, base)));
    else if (
      entry.isFile() &&
      !entry.name.endsWith(".preview.png") &&
      !entry.name.endsWith(".bsp.thumbnail.webp") &&
      !entry.name.endsWith(".artbin-bsp.json") &&
      !entry.name.endsWith(".tea-maps-walkability.json") &&
      entry.name !== "_folder-preview.png"
    ) {
      paths.push(relative(base, fullPath));
    }
  }
  return paths;
}

async function performScan(): Promise<ScanResults> {
  const diskPaths = existsSync(UPLOADS_DIR)
    ? await walkDirectory(UPLOADS_DIR, UPLOADS_DIR)
    : [];
  const diskSet = new Set(diskPaths);
  const records = await db
    .select({
      id: files.id,
      path: files.path,
      status: files.status,
      createdAt: files.createdAt,
    })
    .from(files);
  const recordPaths = new Set(records.map((file) => file.path));
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const inbox = await db.query.folders.findFirst({
    where: eq(folders.slug, "_inbox"),
  });
  const emptyInboxSessions: Array<{ id: string; slug: string }> = [];
  if (inbox) {
    const sessions = await db.query.folders.findMany({
      where: eq(folders.parentId, inbox.id),
    });
    for (const session of sessions) {
      const pending = await db.query.files.findFirst({
        where: and(eq(files.folderId, session.id), eq(files.status, "pending")),
        columns: { id: true },
      });
      if (!pending)
        emptyInboxSessions.push({ id: session.id, slug: session.slug });
    }
  }
  return {
    orphanedFiles: diskPaths.filter((path) => !recordPaths.has(path)),
    missingFiles: records
      .filter((file) => !diskSet.has(file.path))
      .map((file) => ({ id: file.id, path: file.path })),
    staleRejected: records
      .filter(
        (file) =>
          file.status === "rejected" &&
          file.createdAt &&
          file.createdAt < cutoff,
      )
      .map((file) => ({ id: file.id, path: file.path })),
    emptyInboxSessions,
  };
}

function parseArray<T>(value: FormDataEntryValue | null): T[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function withNotice(notice: string): string {
  const url = new URL(routes.admin.orphans.index.href(), "http://artbin.local");
  url.searchParams.set("notice", notice);
  return `${url.pathname}${url.search}`;
}
