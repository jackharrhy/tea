import { z } from "zod";

export const previewTargetSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("all") }).strict(),
  z.object({ scope: z.literal("file"), fileId: z.string().min(1) }).strict(),
  z
    .object({ scope: z.literal("folder"), folderId: z.string().min(1) })
    .strict(),
]);

export type PreviewTarget = z.output<typeof previewTargetSchema>;

export const previewJobInputSchema = z
  .object({
    userId: z.string().min(1),
    target: previewTargetSchema,
  })
  .strict();
