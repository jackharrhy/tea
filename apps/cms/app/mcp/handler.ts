import * as s from "@tea/json-schema";
import * as checks from "@tea/json-schema/checks";
import { createHandler, ToolError, tool, tools } from "@tea/mcp";
import { contentContext } from "../middleware/context.ts";

const declarations = tools({
  listPages: tool("list_published_pages", {
    description:
      "List published pages for this TeaCMS site. Draft content is never returned.",
    input: s.object({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }),
  getPage: tool("get_published_page", {
    description:
      "Read a published page and its content blocks by slug. Use an empty slug for the homepage. Draft content is never returned.",
    input: s.object({
      slug: s.string().pipe(checks.maxLength(200)),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }),
});

const mcp = createHandler({
  name: "teacms",
  title: "TeaCMS",
  version: "1.0.0",
  instructions:
    "Use list_published_pages to discover pages, then get_published_page to read one. Only published content is available.",
});

mcp.tools.map(declarations.listPages, (context) => {
  const store = context.get(contentContext)!;
  return [store.homepage(), ...store.pages()].map(({ slug, title, seo }) => ({
    slug,
    title,
    seo,
  }));
});

mcp.tools.map(declarations.getPage, (context) => {
  const store = context.get(contentContext)!;
  const page =
    context.input.slug === ""
      ? store.homepage()
      : store.page(context.input.slug);
  if (!page) throw new ToolError("No published page has that slug.");
  return page;
});

export function createMcpHandler() {
  return mcp;
}
