import * as s from "remix/data-schema";
import { readRequestBody } from "@tea/request-body";
import { parseAdornmentInstances } from "../features/adornments/public/adornment-instances.ts";
import type { ContentBlock, Page } from "../ui/public/content-types.ts";

export async function readInput(
  request: Request,
): Promise<Record<string, unknown> | null> {
  try {
    const result = await readRequestBody(request, {
      maxBytes: 2 * 1024 * 1024,
      timeoutMs: 30_000,
    });
    if (!result.ok) return null;
    const text = new TextDecoder().decode(result.bytes);
    const value = request.headers
      .get("content-type")
      ?.includes("application/json")
      ? JSON.parse(text)
      : Object.fromEntries(new URLSearchParams(text));
    const data =
      typeof value.data === "string"
        ? {
            ...JSON.parse(value.data),
            revision: value.revision ?? JSON.parse(value.data).revision,
          }
        : value;
    return data && typeof data === "object" && !Array.isArray(data)
      ? data
      : null;
  } catch {
    return null;
  }
}
const text = s.string().refine((v) => v.length <= 2000);
const nullable = s.union([text, s.literal(null)]);
const seoSchema = s.object({
  title: nullable,
  description: nullable,
  image_id: nullable,
  no_index: s.boolean(),
  canonical: nullable,
});
const pageSchema = s.object({
  title: text.refine((v) => v.trim().length > 0),
  revision: s.string(),
  seo: seoSchema,
  blocks: s.array(s.any()),
});
export function parsePage(
  input: unknown,
): Pick<Page, "title" | "seo" | "blocks" | "revision"> | null {
  const result = s.parseSafe(pageSchema, input);
  if (!result.success || !validBlocks(result.value.blocks)) return null;
  if (result.value.seo.canonical && !httpUrl(result.value.seo.canonical))
    return null;
  return { ...result.value, blocks: result.value.blocks as ContentBlock[] };
}
export function validBlocks(
  value: unknown,
  depth = 0,
): value is ContentBlock[] {
  if (!Array.isArray(value) || value.length > 1000 || depth > 12) return false;
  return value.every(
    (b) =>
      b &&
      typeof b === "object" &&
      typeof b.id === "string" &&
      typeof b.type === "string" &&
      b.props &&
      typeof b.props === "object" &&
      !Array.isArray(b.props) &&
      (!b.children || validBlocks(b.children, depth + 1)) &&
      (!b.content || validInline(b.content, depth)) &&
      (b.type !== "markdown" || typeof b.props.body === "string") &&
      (b.type !== "media" ||
        (parseAdornmentInstances(b.props.adornments) !== null &&
          Object.entries(b.props).every(
            ([key, prop]) =>
              ![
                "mediaId",
                "alt",
                "adornments",
                "width",
                "height",
                "padding",
                "margin",
                "top",
                "right",
                "bottom",
                "left",
                "border",
                "filter",
              ].includes(key) || typeof prop === "string",
          ))),
  );
}
function validInline(value: unknown, depth: number): boolean {
  if (!Array.isArray(value) || value.length > 5000 || depth > 12) return false;
  return value.every((node) => {
    if (!node || typeof node !== "object") return false;
    if (node.type === "link")
      return (
        typeof node.href === "string" &&
        (linkUrl(node.href) ||
          /^\/(?!\/)/.test(node.href) ||
          node.href.startsWith("#")) &&
        validInline(node.content, depth + 1)
      );
    return (
      node.type === "text" &&
      typeof node.text === "string" &&
      (!node.styles ||
        (typeof node.styles === "object" &&
          !Array.isArray(node.styles) &&
          Object.values(node.styles).every(
            (v) => typeof v === "boolean" || typeof v === "string",
          )))
    );
  });
}
export function httpUrl(value: string) {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
export function linkUrl(value: string) {
  return /^mailto:[^\s]+$/.test(value) || httpUrl(value);
}
export function validSlug(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) &&
    value.length < 160 &&
    !["tea", "assets", "healthz", "favicon.png"].includes(value.split("/")[0])
  );
}
export const invalid = (
  error = "Please check the form and try again.",
  status = 400,
) => Response.json({ error }, { status });
export function saved(
  request: Request,
  location: string,
  data: unknown = { ok: true },
) {
  return request.headers.get("accept")?.includes("application/json")
    ? Response.json(data)
    : new Response(null, { status: 303, headers: { Location: location } });
}
