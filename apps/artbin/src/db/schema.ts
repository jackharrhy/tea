import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const fileKinds = [
  "texture",
  "model",
  "audio",
  "map",
  "archive",
  "config",
  "other",
] as const;
export type FileKind = (typeof fileKinds)[number];

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  fourmId: text("fourm_id").notNull().unique(),
  isAdmin: integer("is_admin", { mode: "boolean" }).default(false),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    (): Date => new Date(),
  ),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
});

export const cliLoginHandoffs = sqliteTable("cli_login_handoffs", {
  code: text("code").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
});

export const folders = sqliteTable(
  "folders",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(), // Display name: "Thirty Flights"
    slug: text("slug").notNull().unique(), // Path: "thirty-flights/maps" (unique!)
    description: text("description"),
    previewPath: text("preview_path"), // Path to 3x3 preview image (relative to uploads)
    parentId: text("parent_id").references((): any => folders.id, {
      onDelete: "cascade",
    }),
    ownerId: text("owner_id").references(() => users.id, {
      onDelete: "set null",
    }),
    fileCount: integer("file_count").default(0), // Direct file count (not including subfolders)
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      (): Date => new Date(),
    ),
  },
  (table) => ({
    parentIdIdx: index("idx_folders_parent_id").on(table.parentId),
  }),
);

export const files = sqliteTable(
  "files",
  {
    id: text("id").primaryKey(),

    // Path & naming - path is relative to uploads/, e.g. "thirty-flights/maps/lob1.bsp"
    path: text("path").notNull().unique(),
    name: text("name").notNull(), // Just filename: "lob1.bsp"

    // File metadata
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),

    // Asset classification
    kind: text("kind", { enum: fileKinds }).notNull().default("other"),

    // Image-specific (null for non-images)
    width: integer("width"),
    height: integer("height"),
    hasPreview: integer("has_preview", { mode: "boolean" }).default(false), // true if .preview.png exists

    // Relationships
    folderId: text("folder_id")
      .notNull()
      .references(() => folders.id, { onDelete: "cascade" }),
    uploaderId: text("uploader_id").references(() => users.id, {
      onDelete: "set null",
    }),

    // Source tracking
    source: text("source"), // "upload", "extracted-pk3", "extracted-pak", etc.
    sourceArchive: text("source_archive"), // Original archive filename if extracted
    sha256: text("sha256"),

    // Moderation
    status: text("status", {
      enum: ["pending", "approved", "rejected"] as const,
    })
      .notNull()
      .default("approved"),
    suggestedFolderId: text("suggested_folder_id").references(
      () => folders.id,
      {
        onDelete: "set null",
      },
    ),

    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      (): Date => new Date(),
    ),
  },
  (table) => ({
    folderIdIdx: index("idx_files_folder_id").on(table.folderId),
    kindIdx: index("idx_files_kind").on(table.kind),
    createdAtIdx: index("idx_files_created_at").on(table.createdAt),
    kindCreatedIdx: index("idx_files_kind_created").on(
      table.kind,
      table.createdAt,
    ),
    statusIdx: index("idx_files_status").on(table.status),
  }),
);

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(), // Display: "Seamless"
  slug: text("slug").notNull().unique(), // URL-safe: "seamless"
});

export const fileTags = sqliteTable(
  "file_tags",
  {
    fileId: text("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.fileId, table.tagId] }),
  }),
);

export const jobStatuses = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type JobStatus = (typeof jobStatuses)[number];

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(), // "extract-archive", "generate-previews", etc.
    status: text("status", { enum: jobStatuses }).notNull().default("pending"),

    // Job configuration (JSON)
    input: text("input").notNull(), // JSON: { tempFile: "...", targetFolder: "..." }

    // Progress tracking
    progress: integer("progress").default(0), // 0-100
    progressMessage: text("progress_message"), // "Extracting file 50/100..."

    // Results
    output: text("output"), // JSON result when completed
    error: text("error"), // Error message if failed

    // Ownership
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    // Timing
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      (): Date => new Date(),
    ),
    startedAt: integer("started_at", { mode: "timestamp" }),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => ({
    statusIdx: index("idx_jobs_status").on(table.status),
    createdAtIdx: index("idx_jobs_created_at").on(table.createdAt),
  }),
);

export const remoteImports = sqliteTable(
  "remote_imports",
  {
    id: text("id").primaryKey(),
    provider: text("provider", {
      enum: ["gamebanana", "scmapdb", "direct"] as const,
    }).notNull(),
    externalId: text("external_id").notNull(),
    destinationKey: text("destination_key").notNull(),
    sourceUrl: text("source_url").notNull(),
    title: text("title").notNull(),
    author: text("author"),
    game: text("game"),
    metadata: text("metadata").notNull(),
    folderId: text("folder_id")
      .notNull()
      .references(() => folders.id, { onDelete: "cascade" }),
    jobId: text("job_id").references(() => jobs.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
      (): Date => new Date(),
    ),
    updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
      (): Date => new Date(),
    ),
  },
  (table) => ({
    sourceDestinationIdx: uniqueIndex(
      "idx_remote_imports_source_destination",
    ).on(table.provider, table.externalId, table.destinationKey),
    folderIdIdx: index("idx_remote_imports_folder_id").on(table.folderId),
  }),
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(), // JSON-encoded value
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    (): Date => new Date(),
  ),
});

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Folder = typeof folders.$inferSelect;
export type File = typeof files.$inferSelect;
export type Tag = typeof tags.$inferSelect;
export type FileTag = typeof fileTags.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type RemoteImport = typeof remoteImports.$inferSelect;
export type Setting = typeof settings.$inferSelect;
