import type { JSONContent } from "@tiptap/core";
import type { Inline } from "../../../ui/public/content-types.ts";

const known = ["bold", "italic", "underline", "strike", "code"];
function nodes(items: Inline[], link?: string): JSONContent[] {
  return items.flatMap((item) => {
    if (item.type === "link") return nodes(item.content ?? [], item.href);
    const styles = item.styles ?? {};
    const marks: NonNullable<JSONContent["marks"]> = known
      .filter((k) => styles[k])
      .map((type) => ({ type }));
    const extra = Object.fromEntries(
      Object.entries(styles).filter(([k]) => !known.includes(k)),
    );
    if (Object.keys(extra).length)
      marks.push({ type: "legacyStyle", attrs: { value: extra } });
    if (link) marks.push({ type: "link", attrs: { href: link } });
    return (item.text ?? "")
      .split("\n")
      .flatMap((text, index) => [
        ...(index ? [{ type: "hardBreak", marks }] : []),
        ...(text ? [{ type: "text", text, marks }] : []),
      ]);
  });
}
export function textDocument(content: Inline[]): JSONContent {
  return {
    type: "doc",
    content: [{ type: "paragraph", content: nodes(content) }],
  };
}
export function inlineDocument(doc: JSONContent): Inline[] {
  const output: Inline[] = [];
  function append(node: JSONContent) {
    if (node.type !== "text" && node.type !== "hardBreak") {
      node.content?.forEach(append);
      return;
    }
    const styles: Record<string, boolean | string> = {};
    let href: string | undefined;
    for (const mark of node.marks ?? []) {
      if (known.includes(mark.type)) styles[mark.type] = true;
      if (mark.type === "legacyStyle") Object.assign(styles, mark.attrs?.value);
      if (mark.type === "link") href = mark.attrs?.href;
    }
    const text: Inline = {
      type: "text",
      text: node.type === "hardBreak" ? "\n" : (node.text ?? ""),
      styles,
    };
    const previous = output.at(-1);
    if (href && previous?.type === "link" && previous.href === href)
      previous.content!.push(text);
    else output.push(href ? { type: "link", href, content: [text] } : text);
  }
  doc.content?.forEach((node, index) => {
    if (index) output.push({ type: "text", text: "\n", styles: {} });
    append(node);
  });
  return output;
}
