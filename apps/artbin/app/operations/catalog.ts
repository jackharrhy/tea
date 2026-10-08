import { z } from "zod";

import type { OperationContext } from "./context.ts";
import {
  assetDeleteInput,
  assetListInput,
  assetMoveInput,
  assetUploadInput,
  deleteAssetOperation,
  listAssetsOperation,
  moveAssetOperation,
  uploadAssetOperation,
} from "./assets.ts";
import {
  createFoldersOperation,
  deleteFolderOperation,
  folderCreateInput,
  folderDeleteInput,
  folderListInput,
  folderManageInput,
  listFoldersOperation,
  manageFolderOperation,
} from "./folders.ts";
import {
  jobListInput,
  jobManageInput,
  listJobsOperation,
  manageJobOperation,
} from "./jobs.ts";
import { importQueueInput, queueImportOperation } from "./imports.ts";
import {
  previewRegenerateInput,
  queuePreviewRegenerationOperation,
} from "./previews.ts";

type OperationDefinition<S extends z.ZodType, O> = {
  mcpName: string;
  description: string;
  input: S;
  output: z.ZodType<O>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  execute(context: OperationContext, input: unknown): Promise<O>;
};

function defineOperation<S extends z.ZodType, O>(definition: {
  mcpName: string;
  description: string;
  input: S;
  output: z.ZodType<O>;
  annotations: OperationDefinition<S, O>["annotations"];
  run(context: OperationContext, input: z.output<S>): O | Promise<O>;
}): OperationDefinition<S, O> {
  return {
    mcpName: definition.mcpName,
    description: definition.description,
    input: definition.input,
    output: definition.output,
    annotations: definition.annotations,
    execute: async (context, input) =>
      definition.output.parse(
        await Promise.resolve(
          definition.run(context, definition.input.parse(input)),
        ),
      ),
  };
}

const folderSummary = z
  .object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable(),
    parentId: z.string().nullable(),
    parentSlug: z.string().nullable(),
    fileCount: z.number(),
    childCount: z.number(),
    descendantCount: z.number(),
    totalFileCount: z.number(),
    createdAt: z.string().nullable(),
  })
  .strict();

const folderPlan = z
  .object({
    operation: z.enum(["rename", "move"]),
    from: z.object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      parentSlug: z.string().nullable(),
    }),
    to: z.object({
      name: z.string(),
      slug: z.string(),
      parentSlug: z.string().nullable(),
    }),
    affected: z.object({ folders: z.number(), files: z.number() }),
    noOp: z.boolean(),
  })
  .strict();

const storedFolder = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  parentId: z.string().nullable(),
  ownerId: z.string().nullable(),
  fileCount: z.number().nullable(),
  previewPath: z.string().nullable(),
  createdAt: z.string().nullable(),
});

const assetSummary = z
  .object({
    id: z.string(),
    name: z.string(),
    path: z.string(),
    folderSlug: z.string(),
    kind: z.string(),
    mimeType: z.string(),
    size: z.number(),
    sha256: z.string().nullable(),
    status: z.enum(["pending", "approved", "rejected"]),
    createdAt: z.string().nullable(),
  })
  .strict();

const jobOutput = z.object({
  id: z.string(),
  type: z.string(),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
  input: z.string(),
  progress: z.number().nullable(),
  progressMessage: z.string().nullable(),
  output: z.string().nullable(),
  error: z.string().nullable(),
  userId: z.string().nullable(),
  createdAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  isStuck: z.boolean(),
});

const executionAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const operationCatalog = {
  foldersList: defineOperation({
    mcpName: "artbin_folders_list",
    description:
      "List folders or inspect one folder. Administrators may include system folders.",
    input: folderListInput,
    output: z.object({
      folders: z.array(folderSummary).optional(),
      nextCursor: z.string().optional(),
      folder: folderSummary
        .extend({
          children: z.array(folderSummary),
          source: z.record(z.string(), z.unknown()).nullable(),
        })
        .optional(),
    }),
    annotations: readAnnotations,
    run: listFoldersOperation,
  }),
  folderDelete: defineOperation({
    mcpName: "artbin_folder_delete",
    description:
      "Plan or explicitly confirm deletion of a folder, its descendants, and their assets.",
    input: folderDeleteInput,
    output: z.object({
      applied: z.boolean(),
      plan: z.object({
        folder: z.object({
          id: z.string(),
          name: z.string(),
          slug: z.string(),
        }),
        affected: z.object({ folders: z.number(), files: z.number() }),
      }),
      deleted: z.object({ folders: z.number(), files: z.number() }).optional(),
    }),
    annotations: executionAnnotations,
    run: deleteFolderOperation,
  }),
  assetsList: defineOperation({
    mcpName: "artbin_assets_list",
    description:
      "List assets with bounded, cursor-based pagination and optional filters.",
    input: assetListInput,
    output: z.object({
      assets: z.array(assetSummary),
      nextCursor: z.string().optional(),
    }),
    annotations: readAnnotations,
    run: listAssetsOperation,
  }),
  assetUpload: defineOperation({
    mcpName: "artbin_asset_upload",
    description:
      "Upload one base64-encoded asset of up to 5 MiB into an existing folder.",
    input: assetUploadInput,
    output: z.object({ asset: assetSummary }),
    annotations: executionAnnotations,
    run: uploadAssetOperation,
  }),
  assetDelete: defineOperation({
    mcpName: "artbin_asset_delete",
    description:
      "Plan or explicitly confirm deletion of one asset and its stored bytes.",
    input: assetDeleteInput,
    output: z.object({
      applied: z.boolean(),
      plan: z.object({ asset: assetSummary }),
      deleted: z.object({ id: z.string(), path: z.string() }).optional(),
    }),
    annotations: executionAnnotations,
    run: deleteAssetOperation,
  }),
  assetMove: defineOperation({
    mcpName: "artbin_asset_move",
    description:
      "Plan or explicitly confirm moving one asset to another existing folder.",
    input: assetMoveInput,
    output: z.object({
      applied: z.boolean(),
      plan: z.object({
        asset: assetSummary,
        destination: z.object({
          id: z.string(),
          slug: z.string(),
          path: z.string(),
        }),
        noOp: z.boolean(),
      }),
      asset: assetSummary.optional(),
    }),
    annotations: executionAnnotations,
    run: moveAssetOperation,
  }),
  foldersCreate: defineOperation({
    mcpName: "artbin_folders_create",
    description:
      "Create one or more folders as the authenticated Artbin administrator.",
    input: folderCreateInput,
    output: z.object({
      applied: z.boolean(),
      plan: z.object({
        create: z.array(
          z.object({
            slug: z.string(),
            name: z.string(),
            parentSlug: z.string().nullable(),
          }),
        ),
        existing: z.array(z.object({ slug: z.string(), id: z.string() })),
      }),
      created: z
        .array(z.object({ slug: z.string(), id: z.string() }))
        .optional(),
      existing: z
        .array(z.object({ slug: z.string(), id: z.string() }))
        .optional(),
    }),
    annotations: executionAnnotations,
    run: createFoldersOperation,
  }),
  folderManage: defineOperation({
    mcpName: "artbin_folder_manage",
    description:
      "Plan or explicitly confirm and apply a folder rename or move.",
    input: folderManageInput,
    output: z.object({
      success: z.literal(true),
      applied: z.boolean(),
      plan: folderPlan,
      result: z
        .object({
          folder: storedFolder.optional(),
          renamedFolders: z.number().optional(),
          renamedFiles: z.number().optional(),
          movedFolders: z.number().optional(),
          movedFiles: z.number().optional(),
        })
        .optional(),
    }),
    annotations: executionAnnotations,
    run: manageFolderOperation,
  }),
  jobsList: defineOperation({
    mcpName: "artbin_jobs_list",
    description:
      "List Artbin background jobs and identify jobs that appear stuck.",
    input: jobListInput,
    output: z.object({ jobs: z.array(jobOutput) }),
    annotations: readAnnotations,
    run: listJobsOperation,
  }),
  jobManage: defineOperation({
    mcpName: "artbin_job_manage",
    description:
      "Cancel, reset, or delete a background job. Requires confirm=true.",
    input: jobManageInput,
    output: z
      .object({
        jobId: z.string(),
        operation: z.enum(["cancel", "reset", "delete"]),
        deleted: z.literal(true).optional(),
        job: jobOutput.optional(),
      })
      .strict(),
    annotations: executionAnnotations,
    run: manageJobOperation,
  }),
  previewRegenerate: defineOperation({
    mcpName: "artbin_preview_regenerate",
    description:
      "Replace stale derivatives for one BSP file, one folder's direct BSP files, or the full library. A full refresh also rebuilds generated file and folder previews. Requires confirm=true.",
    input: previewRegenerateInput,
    output: z.object({
      jobId: z.string(),
      target: previewRegenerateInput.shape.target,
    }),
    annotations: executionAnnotations,
    run: queuePreviewRegenerationOperation,
  }),
  importQueue: defineOperation({
    mcpName: "artbin_import_queue",
    description:
      "Queue a remote, local-folder, or built-in catalog import. Requires confirm=true.",
    input: importQueueInput,
    output: z
      .object({ count: z.number(), jobIds: z.array(z.string()) })
      .strict(),
    annotations: { ...executionAnnotations, openWorldHint: true },
    run: queueImportOperation,
  }),
} as const;

export const mcpOperations = new Map(
  Object.values(operationCatalog).map((operation) => [
    operation.mcpName,
    operation,
  ]),
);

export const mcpTools = Object.values(operationCatalog).map((operation) => ({
  name: operation.mcpName,
  description: operation.description,
  inputSchema: z.toJSONSchema(operation.input, { target: "draft-7" }),
  outputSchema: z.toJSONSchema(operation.output, { target: "draft-7" }),
  annotations: operation.annotations,
}));
