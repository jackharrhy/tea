import type { ContentBlock } from "./content-types.ts";
import { parseAdornmentInstances } from "../../features/adornments/public/adornment-instances.ts";

export function* walkBlocks(blocks: ContentBlock[]): Generator<ContentBlock> {
  for (const block of blocks) {
    yield block;
    yield* walkBlocks(block.children ?? []);
  }
}
export function blockReferences(blocks: ContentBlock[]) {
  const media = new Set<string>(),
    adornments = new Set<string>();
  for (const block of walkBlocks(blocks)) {
    if (typeof block.props.mediaId === "string" && block.props.mediaId)
      media.add(block.props.mediaId);
    if (block.type === "markdown" && typeof block.props.body === "string") {
      for (const match of block.props.body.matchAll(
        /[/]tea[/]api[/]media[/]file[/]([a-zA-Z0-9_%.-]+)/g,
      )) {
        try {
          media.add(decodeURIComponent(match[1]));
        } catch {
          /* Invalid URL cannot resolve to a file. */
        }
      }
    }
    for (const item of parseAdornmentInstances(block.props.adornments) ?? [])
      adornments.add(item.adornmentName);
  }
  return { media, adornments };
}
