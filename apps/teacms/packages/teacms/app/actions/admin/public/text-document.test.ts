import { it } from "remix/test";
import * as assert from "remix/assert";
import { textDocument, inlineDocument } from "./text-document.ts";

it("round-trips links, marks, multiline text and imported style metadata through TipTap", () => {
  const initial = [
    {
      type: "text",
      text: "Hello\nworld",
      styles: { bold: true, textColor: "#654321", future: "keep" },
    },
    {
      type: "link",
      href: "/about",
      content: [
        {
          type: "text",
          text: "About",
          styles: { italic: true, underline: true },
        },
      ],
    },
  ];
  const doc = textDocument(initial);
  assert.deepEqual(textDocument(inlineDocument(doc)), doc);
  assert.equal(inlineDocument(doc)[0].styles?.future, "keep");
});
