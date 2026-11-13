import { CommunityError } from "./data/community.ts";
import type { Row } from "./data/community.ts";

export function apiPage(row: Row) {
  return {
    slug: row.slug,
    title: row.title,
    content: row.content ?? "",
    content_format: row.content_format ?? "html",
    layout: row.layout ?? "default",
    is_public: Boolean(row.is_public),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
export function pageWrite(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CommunityError(422, "Expected a page object");
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).some(
      (key) =>
        !["title", "content", "content_format", "layout", "is_public"].includes(
          key,
        ),
    )
  )
    throw new CommunityError(422, "Unknown page field");
  for (const key of ["title", "content", "content_format", "layout"]) {
    if (body[key] !== undefined && typeof body[key] !== "string")
      throw new CommunityError(422, `Invalid ${key}`);
  }
  if (body.is_public !== undefined && typeof body.is_public !== "boolean")
    throw new CommunityError(422, "is_public must be a boolean");
  return {
    title: String(body.title ?? ""),
    content: String(body.content ?? ""),
    content_format: String(body.content_format ?? "html"),
    layout: String(body.layout ?? "default"),
    is_public: body.is_public === false ? 0 : 1,
  };
}
