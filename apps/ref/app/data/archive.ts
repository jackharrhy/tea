import type { BoardRecord } from "./directory-cell.ts";
import type { LinkPreview } from "./protocol.ts";
import { normalizeLinkUrl } from "./link-preview.ts";

export const UUID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export const HASH_PATTERN = /^[0-9a-f]{64}$/;

export function parseBoardRecord(value: unknown): BoardRecord | null {
  if (!isRecord(value)) return null;
  const { id, title, createdAt, updatedAt } = value;
  if (
    typeof id !== "string" ||
    !UUID_PATTERN.test(id) ||
    typeof title !== "string" ||
    title.trim() !== title ||
    title.length < 1 ||
    title.length > 100 ||
    !Number.isSafeInteger(createdAt) ||
    !Number.isSafeInteger(updatedAt) ||
    (createdAt as number) <= 0 ||
    (updatedAt as number) < (createdAt as number)
  )
    return null;
  return {
    id,
    title,
    createdAt: createdAt as number,
    updatedAt: updatedAt as number,
  };
}

export function parseArchivedPreview(
  value: unknown,
  boardId: string,
): LinkPreview | null {
  if (!isRecord(value)) return null;
  const { url, title, description, imageUrl, siteName } = value;
  if (
    typeof url !== "string" ||
    normalizeLinkUrl(url) !== url ||
    typeof title !== "string" ||
    title.length < 1 ||
    title.length > 200 ||
    typeof description !== "string" ||
    description.length > 700 ||
    typeof siteName !== "string" ||
    siteName.length > 100 ||
    (imageUrl !== null &&
      (typeof imageUrl !== "string" ||
        (normalizeLinkUrl(imageUrl) !== imageUrl &&
          !new RegExp(`^/previews/${boardId}/[0-9a-f]{64}$`).test(imageUrl))))
  )
    return null;
  return {
    url,
    title,
    description,
    imageUrl: imageUrl as string | null,
    siteName,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
