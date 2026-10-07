import { z } from "zod";
import {
  EDITOR_STORES,
  openEditorDatabase,
} from "./editor-collaboration-database.ts";

const DetachedSummarySchema = z.object({
  id: z.string().min(1).max(256),
  fileName: z.string().min(1).max(4_096),
  reason: z.string().min(1).max(4_096),
  createdAt: z.number().int().nonnegative(),
});

export interface DetachedMapSummary {
  readonly id: string;
  readonly name: string;
  readonly reason: string;
  readonly createdAt: number;
}

export async function listDetachedMapSummaries(): Promise<
  readonly DetachedMapSummary[]
> {
  const values: unknown[] = await (
    await openEditorDatabase()
  ).getAll(EDITOR_STORES.detachedMaps);
  return values
    .flatMap((value) => {
      const parsed = DetachedSummarySchema.safeParse(value);
      return parsed.success
        ? [
            {
              id: parsed.data.id,
              name: parsed.data.fileName,
              reason: parsed.data.reason,
              createdAt: parsed.data.createdAt,
            },
          ]
        : [];
    })
    .toSorted((left, right) => right.createdAt - left.createdAt);
}
