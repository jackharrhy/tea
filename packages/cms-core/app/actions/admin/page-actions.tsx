import type { AppContext } from "../../router.ts";
import { routes } from "../../routes.ts";
import { contentContext } from "../../middleware/context.ts";
import {
  blockReferences,
  walkBlocks,
} from "../../ui/public/block-references.ts";
import { readInput, parsePage, invalid, saved, validSlug } from "../input.ts";
import type { SiteRuntime } from "../../site.ts";
import type { ContentStore } from "../../data/content.ts";
import type { ContentBlock, Page } from "../../ui/public/content-types.ts";
import { AdminLayout } from "./layout.tsx";
import { Editor } from "./public/editor.tsx";
import { Pages } from "./pages.tsx";

type PageContext = AppContext & { params: { slug: string } };

const visualSlug = (slug: string) => (slug === "~" ? "" : slug);
const editableText = (block: ContentBlock) =>
  [
    "heading",
    "paragraph",
    "quote",
    "bulletListItem",
    "numberedListItem",
  ].includes(block.type) &&
  !block.children?.length &&
  (!block.content?.length ||
    (block.content.length === 1 &&
      block.content[0].type === "text" &&
      !Object.values(block.content[0].styles ?? {}).some(Boolean)));

export function createPageActions(site: SiteRuntime, operatorOrigin?: string) {
  function editor(context: AppContext, slug: string) {
    const store: ContentStore = context.get(contentContext),
      page = store.editorPage(slug);
    if (!page) return new Response("Page not found", { status: 404 });
    return context.render(
      <AdminLayout
        siteName={site.name}
        operatorOrigin={operatorOrigin}
        adornments={site.definition.features.adornments}
        title={slug ? "Page editor" : "Homepage"}
        path={slug ? "/tea/admin/pages" : "/tea/admin/homepage"}
        wide
        editor
      >
        <Editor
          features={site.definition.features}
          page={page}
          searchOpen={context.url.searchParams.get("section") === "seo"}
          media={store.media()}
          adornments={store.adornments()}
        />
      </AdminLayout>,
    );
  }
  function referencesValid(
    page: Pick<Page, "blocks" | "seo">,
    store: ContentStore,
  ) {
    for (const block of walkBlocks(page.blocks)) {
      if (!site.definition.features.riso && block.type === "special")
        return false;
      if (
        !site.definition.features.adornments &&
        block.props.adornments &&
        block.props.adornments !== "[]"
      )
        return false;
    }
    const refs = blockReferences(page.blocks);
    const names = new Set(store.adornments().map((a) => a.name));
    return (
      [...refs.media].every((id) => !!store.mediaItem(id)) &&
      [...refs.adornments].every((name) => names.has(name)) &&
      (!page.seo.image_id || !!store.mediaItem(page.seo.image_id))
    );
  }
  async function savePage(context: AppContext, slug: string) {
    const data = parsePage(await readInput(context.request)),
      store: ContentStore = context.get(contentContext);
    if (!data)
      return invalid("Not saved. Check the title, blocks, and search fields.");
    if (!referencesValid(data, store))
      return invalid(
        "An image or adornment is missing. Choose an existing item before saving.",
      );
    const result = store.saveDraft(slug, data, data.revision);
    return result.ok
      ? saved(
          context.request,
          slug ? "/tea/admin/pages/" + slug : "/tea/admin/homepage",
          result,
        )
      : invalid(result.error, result.status);
  }
  async function publishPage(context: AppContext, slug: string) {
    const input = await readInput(context.request),
      store: ContentStore = context.get(contentContext);
    const draft = store.editorPage(slug);
    if (!draft || !referencesValid(draft, store))
      return invalid("Check the draft images before publishing.");
    const result = store.publishDraft(
      slug,
      typeof input?.revision === "string" ? input.revision : "",
    );
    return result.ok
      ? Response.json(result)
      : invalid(result.error, result.status);
  }
  return {
    pages(c: AppContext) {
      const query = c.url.searchParams.get("q") ?? "";
      const pages = c
        .get(contentContext)
        .editorPages()
        .filter((p) =>
          (p.title + " " + p.slug).toLowerCase().includes(query.toLowerCase()),
        );
      return c.render(
        <Pages
          site={site}
          pages={pages}
          query={query}
          operatorOrigin={operatorOrigin}
        />,
      );
    },
    async createPage(c: AppContext) {
      const data = await readInput(c.request);
      if (
        !data ||
        typeof data.title !== "string" ||
        !data.title.trim() ||
        data.title.length > 200 ||
        !validSlug(data.slug)
      )
        return invalid("Enter a title and a lowercase, hyphen-separated URL.");
      const result = c
        .get(contentContext)
        .createPage(data.title.trim(), data.slug);
      return result.ok
        ? saved(c.request, "/tea/admin/pages/" + data.slug, result)
        : invalid(result.error, result.status);
    },
    edit(c: PageContext) {
      return editor(c, c.params.slug);
    },
    visual(c: PageContext) {
      const page = c.get(contentContext).editorPage(visualSlug(c.params.slug));
      if (!page) return new Response("Page not found", { status: 404 });
      return Response.json({
        revision: page.revision,
        fields: [...walkBlocks(page.blocks)]
          .filter(editableText)
          .map((block) => ({
            id: block.id,
            text: block.content?.[0]?.text ?? "",
          })),
      });
    },
    async saveVisual(c: PageContext) {
      const input = await readInput(c.request);
      const slug = visualSlug(c.params.slug);
      if (
        typeof input?.id !== "string" ||
        typeof input.text !== "string" ||
        typeof input.revision !== "string" ||
        input.text.length > 2000
      )
        return invalid("Enter up to 2,000 characters.");
      const store = c.get(contentContext);
      const page = store.editorPage(slug);
      if (!page) return invalid("Page not found.", 404);
      if (page.revision !== input.revision)
        return invalid(
          "The draft changed. Reload before editing this field.",
          409,
        );
      const block = [...walkBlocks(page.blocks)].find(
        (item) => item.id === input.id,
      );
      if (!block || !editableText(block))
        return invalid("This field needs the full editor.", 400);
      block.content = block.content?.length
        ? [{ ...block.content[0], text: input.text }]
        : [{ type: "text", text: input.text }];
      const result = store.saveDraft(slug, page, page.revision);
      return result.ok
        ? Response.json(result)
        : invalid(result.error, result.status);
    },
    save(c: PageContext) {
      return savePage(c, c.params.slug);
    },
    homepage(c: AppContext) {
      return editor(c, "");
    },
    saveHomepage(c: AppContext) {
      return savePage(c, "");
    },
    async publish(c: PageContext) {
      return publishPage(c, c.params.slug);
    },
    async publishHomepage(c: AppContext) {
      return publishPage(c, "");
    },
    async deletePage(c: PageContext) {
      const data = await readInput(c.request);
      const result = c
        .get(contentContext)
        .deletePage(
          c.params.slug,
          typeof data?.revision === "string" ? data.revision : "",
        );
      return result.ok
        ? saved(c.request, routes.admin.pages.href())
        : invalid(result.error, result.status);
    },
  };
}
