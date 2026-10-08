import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { createController } from "remix/router";
import { redirect } from "remix/response/redirect";
import { css, type Handle } from "remix/component";

import { folders } from "#db";
import { db } from "#db/connection.server";
import {
  approveSession,
  getPendingSessionsWithFiles,
  rejectSession,
} from "#lib/inbox.server";

import { requireAdmin } from "../../../middleware/auth.ts";
import { mediaFileHref, routes } from "../../../routes.ts";
import { AdminPage } from "../../../ui/admin-page.tsx";
import { formatSize } from "../../../ui/file-collection.tsx";
import { MediaCard } from "../../../ui/media-card.tsx";
import {
  Alert,
  Button,
  EmptyState,
  FormField,
  Panel,
  SectionHeader,
  SelectInput,
} from "../../../ui/primitives.tsx";
import { theme } from "../../../ui/styles.ts";

const countStyle = css({
  color: theme.color.muted,
  fontSize: "0.875rem",
  margin: "0 0 1rem",
});
const sessionsStyle = css({
  display: "flex",
  flexDirection: "column",
  gap: "1.5rem",
});
const mutedStyle = css({ color: theme.color.muted });
const bulkStyle = css({
  marginBottom: "1.5rem",
});
const bulkFormStyle = css({
  alignItems: "end",
  display: "flex",
  flexWrap: "wrap",
  gap: "0.75rem",
});
const sessionHeaderStyle = css({
  borderBottom: `1px solid ${theme.color.borderLight}`,
  marginBottom: "0.75rem",
  paddingBottom: "0.75rem",
});
const metadataStyle = css({ fontSize: "0.875rem", margin: 0 });
const suggestionStyle = css({
  color: theme.color.muted,
  fontSize: "0.875rem",
  margin: "0.25rem 0 0",
});
const countDetailStyle = css({
  color: theme.color.faint,
  fontSize: "0.75rem",
  margin: "0.25rem 0 0",
});
const filesGridStyle = css({
  display: "grid",
  gap: "0.5rem",
  gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
  marginBottom: "1rem",
});
const actionRowStyle = css({
  alignItems: "end",
  borderTop: `1px solid ${theme.color.borderLight}`,
  display: "flex",
  gap: "1rem",
  paddingTop: "0.75rem",
});
const approveFormStyle = css({
  alignItems: "end",
  display: "flex",
  flex: "1",
  gap: "0.5rem",
});
const growStyle = css({ flex: "1" });

type PendingSession = Awaited<
  ReturnType<typeof getPendingSessionsWithFiles>
>[number];

export default createController(routes.admin.inbox, {
  middleware: [requireAdmin()],
  actions: {
    async index(context) {
      if (!context.user) return redirect(routes.login.href(), 303);

      const [sessions, allFolders] = await Promise.all([
        getPendingSessionsWithFiles(),
        db.query.folders.findMany({
          where: and(
            isNull(folders.parentId),
            sql`substr(${folders.slug}, 1, 1) <> '_'`,
          ),
          orderBy: [desc(folders.createdAt)],
        }),
      ]);
      const uploaderMap = new Map<string, string>();
      for (const session of sessions) {
        if (session.uploader)
          uploaderMap.set(session.uploader.id, session.uploader.username);
      }
      const uploaders = [...uploaderMap].map(([id, username]) => ({
        id,
        username,
      }));
      const totalPendingFiles = sessions.reduce(
        (total, session) => total + session.files.length,
        0,
      );
      const notice = new URL(context.request.url).searchParams.get("notice");

      return context.render(
        <AdminPage user={context.user} active="inbox" title="Upload inbox">
          {notice ? <Alert tone="success">{notice}</Alert> : null}
          {totalPendingFiles ? (
            <p mix={countStyle}>
              {totalPendingFiles} file{totalPendingFiles === 1 ? "" : "s"} in{" "}
              {sessions.length} session{sessions.length === 1 ? "" : "s"}
            </p>
          ) : null}
          {sessions.length > 1 ? (
            <BulkActions folders={allFolders} uploaders={uploaders} />
          ) : null}
          {sessions.length ? (
            <div mix={sessionsStyle}>
              {sessions.map((session) => (
                <InboxSession
                  key={session.folder.id}
                  session={session}
                  folders={allFolders}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No pending uploads"
              description="New member uploads will appear here for review."
            />
          )}
        </AdminPage>,
      );
    },

    async action(context) {
      const form = await context.request.formData();
      const intent = text(form.get("intent"));
      const uploaderId = text(form.get("uploaderId")) || null;

      if (intent === "approve-all" || intent === "reject-all") {
        const allSessions = await getPendingSessionsWithFiles();
        const sessions = uploaderId
          ? allSessions.filter((session) => session.uploader?.id === uploaderId)
          : allSessions;
        let changed = 0;
        let skipped = 0;
        let failed = 0;

        if (intent === "approve-all") {
          const destination = await findDestination(
            form.get("destinationFolderId"),
          );
          if (destination instanceof Response) return destination;
          for (const session of sessions) {
            try {
              const result = await approveSession(
                session.folder.id,
                destination.id,
                destination.slug,
              );
              changed += result.approvedCount;
              skipped += result.skippedCount;
            } catch (error) {
              failed++;
              console.error(
                "Unable to approve upload session",
                session.folder.id,
                error,
              );
            }
          }
        } else {
          for (const session of sessions) {
            try {
              changed += (await rejectSession(session.folder.id)).rejectedCount;
            } catch (error) {
              failed++;
              console.error(
                "Unable to reject upload session",
                session.folder.id,
                error,
              );
            }
          }
        }

        const verb = intent === "approve-all" ? "Approved" : "Rejected";
        const details = [
          `${verb} ${changed} file${changed === 1 ? "" : "s"} across ${sessions.length} session${sessions.length === 1 ? "" : "s"}.`,
          skipped
            ? `${skipped} missing file record${skipped === 1 ? " was" : "s were"} moved.`
            : "",
          failed ? `${failed} session${failed === 1 ? "" : "s"} failed.` : "",
        ]
          .filter(Boolean)
          .join(" ");
        return redirect(withNotice(details), 303);
      }

      const sessionId = text(form.get("sessionFolderId"));
      if (!sessionId)
        return new Response("Missing upload session", { status: 400 });

      if (intent === "approve") {
        const destination = await findDestination(
          form.get("destinationFolderId"),
        );
        if (destination instanceof Response) return destination;
        try {
          const result = await approveSession(
            sessionId,
            destination.id,
            destination.slug,
          );
          return redirect(
            withNotice(
              `Approved ${result.approvedCount} file${result.approvedCount === 1 ? "" : "s"}.${
                result.skippedCount
                  ? ` ${result.skippedCount} missing file record${result.skippedCount === 1 ? " was" : "s were"} moved.`
                  : ""
              }`,
            ),
            303,
          );
        } catch (error) {
          return new Response(
            `Approval failed: ${error instanceof Error ? error.message : String(error)}`,
            { status: 500 },
          );
        }
      }

      if (intent === "reject") {
        const result = await rejectSession(sessionId);
        return redirect(
          withNotice(
            `Rejected ${result.rejectedCount} file${result.rejectedCount === 1 ? "" : "s"}.`,
          ),
          303,
        );
      }

      return new Response("Unknown inbox action", { status: 400 });
    },
  },
});

function BulkActions(
  handle: Handle<{
    folders: Array<typeof folders.$inferSelect>;
    uploaders: Array<{ id: string; username: string }>;
  }>,
) {
  return () => (
    <section mix={bulkStyle}>
      <Panel>
        <SectionHeader title="Bulk actions" />
        <form
          method="post"
          action={routes.admin.inbox.action.href()}
          mix={bulkFormStyle}
        >
          <FormField
            label="Destination folder"
            htmlFor="bulk-destination-folder"
          >
            <SelectInput
              id="bulk-destination-folder"
              name="destinationFolderId"
            >
              <option value="">Select a folder</option>
              {handle.props.folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </SelectInput>
          </FormField>
          {handle.props.uploaders.length > 1 ? (
            <FormField
              label="Filter by uploader"
              htmlFor="bulk-uploader-filter"
            >
              <SelectInput id="bulk-uploader-filter" name="uploaderId">
                <option value="">All uploaders</option>
                {handle.props.uploaders.map((uploader) => (
                  <option key={uploader.id} value={uploader.id}>
                    @{uploader.username}
                  </option>
                ))}
              </SelectInput>
            </FormField>
          ) : null}
          <Button
            type="submit"
            name="intent"
            value="approve-all"
            variant="primary"
          >
            Approve all
          </Button>
          <Button
            type="submit"
            name="intent"
            value="reject-all"
            variant="danger"
          >
            Reject all
          </Button>
        </form>
      </Panel>
    </section>
  );
}

function InboxSession(
  handle: Handle<{
    session: PendingSession;
    folders: Array<typeof folders.$inferSelect>;
  }>,
) {
  return () => {
    const { session, folders: destinationFolders } = handle.props;
    return (
      <section>
        <Panel>
          <div mix={sessionHeaderStyle}>
            <p mix={metadataStyle}>
              <span mix={mutedStyle}>Uploaded by </span>
              <strong>
                {session.uploader ? `@${session.uploader.username}` : "Unknown"}
              </strong>
              <span mix={mutedStyle}>
                {" "}
                on {formatDate(session.folder.createdAt)}
              </span>
            </p>
            {session.suggestedFolder ? (
              <p mix={suggestionStyle}>
                Suggested folder: <span>{session.suggestedFolder.name}</span>
              </p>
            ) : null}
            <p mix={countDetailStyle}>
              {session.files.length} file{session.files.length === 1 ? "" : "s"}
            </p>
          </div>

          <div mix={filesGridStyle}>
            {session.files.map((file) => {
              const thumbnail = thumbnailUrl(file);
              return (
                <MediaCard
                  key={file.id}
                  imageSrc={thumbnail ?? undefined}
                  imageAlt={file.name}
                  placeholder={file.kind === "texture" ? "🖼️" : "📎"}
                  title={file.name}
                  meta={`${file.kind} · ${formatSize(file.size)}`}
                />
              );
            })}
          </div>

          <div mix={actionRowStyle}>
            <form
              method="post"
              action={routes.admin.inbox.action.href()}
              mix={approveFormStyle}
            >
              <input
                type="hidden"
                name="sessionFolderId"
                value={session.folder.id}
              />
              <div mix={growStyle}>
                <FormField
                  label="Destination folder"
                  htmlFor={`${session.folder.id}-destination-folder`}
                >
                  <SelectInput
                    id={`${session.folder.id}-destination-folder`}
                    name="destinationFolderId"
                    value={session.suggestedFolder?.id ?? ""}
                    fullWidth
                  >
                    <option value="">Select a folder</option>
                    {destinationFolders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </SelectInput>
                </FormField>
              </div>
              <Button
                type="submit"
                name="intent"
                value="approve"
                variant="primary"
              >
                Approve
              </Button>
            </form>
            <form method="post" action={routes.admin.inbox.action.href()}>
              <input
                type="hidden"
                name="sessionFolderId"
                value={session.folder.id}
              />
              <Button
                type="submit"
                name="intent"
                value="reject"
                variant="danger"
              >
                Reject
              </Button>
            </form>
          </div>
        </Panel>
      </section>
    );
  };
}

async function findDestination(value: FormDataEntryValue | null) {
  const id = text(value);
  if (!id)
    return new Response("Please select a destination folder", { status: 400 });
  const folder = await db.query.folders.findFirst({
    where: eq(folders.id, id),
  });
  return (
    folder ?? new Response("Destination folder not found", { status: 404 })
  );
}

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value : "";
}

function withNotice(notice: string): string {
  const url = new URL(routes.admin.inbox.index.href(), "http://artbin.local");
  url.searchParams.set("notice", notice);
  return `${url.pathname}${url.search}`;
}

function formatDate(value: Date | null): string {
  return value
    ? new Intl.DateTimeFormat("en-CA", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Unknown";
}

function thumbnailUrl(file: {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  hasPreview: boolean | null;
}): string | null {
  if (
    [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/svg+xml",
    ].includes(file.mimeType)
  ) {
    return mediaFileHref(file);
  }
  return file.hasPreview ? mediaFileHref(file, { preview: true }) : null;
}
