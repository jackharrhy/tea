import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkSmartypants from "remark-smartypants";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import rehypeShiki from "@shikijs/rehype";
import { remarkObsidian } from "./remark-obsidian.mjs";
import { rehypeObsidian } from "./rehype-obsidian.mjs";
import type { GardenIndex } from "./garden-routing.mjs";

export type RenderedSegment =
  | { type: "prose"; html: string }
  | { type: "component"; props: Record<string, string> };
const componentNames = new Set([
  "Mug",
  "NowPlaying",
  "Feed",
  "FeedTree",
  "Project",
  "Letterbird",
]);

export function createMarkdownRenderer(index: GardenIndex) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkSmartypants)
    .use(remarkObsidian, { gardenIndex: index })
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSlug)
    .use(rehypeObsidian)
    .use(rehypeShiki, {
      theme: "github-dark",
      langAlias: { component: "text" },
      fallbackLanguage: "text",
    })
    .use(rehypeStringify);
  const cache = new Map<string, Promise<RenderedSegment[]>>();

  async function render(body: string): Promise<RenderedSegment[]> {
    const segments: RenderedSegment[] = [];
    let offset = 0;
    async function prose(value: string) {
      if (value.trim())
        segments.push({
          type: "prose",
          html: String(await processor.process(value.trim())).replaceAll(
            'class="shiki ',
            'class="astro-code ',
          ),
        });
    }
    for (const match of body.matchAll(
      /^```component\r?\n([\s\S]*?)^```[ \t]*$/gm,
    )) {
      await prose(body.slice(offset, match.index));
      const lines = match[1]
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      const props: Record<string, string> = { component: lines[0] };
      if (!componentNames.has(props.component))
        throw new Error(`Unknown component block: ${props.component}`);
      for (const line of lines.slice(1)) {
        const colon = line.indexOf(":");
        if (colon !== -1)
          props[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
      }
      segments.push({ type: "component", props });
      offset = match.index + match[0].length;
    }
    await prose(body.slice(offset));
    return segments;
  }
  return (body: string) => {
    let result = cache.get(body);
    if (!result) {
      result = render(body);
      cache.set(body, result);
    }
    return result;
  };
}
