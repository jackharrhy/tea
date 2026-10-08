import { Schema, type Node as PMNode } from "prosemirror-model";

// Plain-text-only schema: a sequence of paragraphs of text. We treat .md files
// as line-separated text on disk; rendering and editing happens at this level
// rather than parsing Markdown into structured nodes.
export const plainTextSchema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: {
      content: "text*",
      group: "block",
      parseDOM: [{ tag: "p" }],
      toDOM: () => ["p", 0],
    },
    text: {},
  },
});

export function textToDoc(text: string): PMNode {
  if (!text) {
    return plainTextSchema.node("doc", null, [
      plainTextSchema.node("paragraph"),
    ]);
  }
  const lines = text.split("\n");
  const paragraphs = lines.map((line) =>
    line === ""
      ? plainTextSchema.node("paragraph")
      : plainTextSchema.node("paragraph", null, [plainTextSchema.text(line)]),
  );
  return plainTextSchema.node("doc", null, paragraphs);
}

export function docToText(doc: PMNode): string {
  const paragraphs: string[] = [];
  doc.forEach((node) => {
    if (node.type.name === "paragraph") {
      paragraphs.push(node.textContent);
    }
  });
  return paragraphs.join("\n");
}
