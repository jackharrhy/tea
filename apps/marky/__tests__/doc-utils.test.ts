import * as assert from "remix/assert";
import { describe, it } from "remix/test";

import {
  docToText,
  plainTextSchema,
  textToDoc,
} from "../app/shared/doc-utils.ts";

describe("doc-utils", () => {
  it("round-trips empty content", () => {
    const doc = textToDoc("");
    assert.equal(docToText(doc), "");
  });

  it("round-trips a single line", () => {
    const doc = textToDoc("hello world");
    assert.equal(docToText(doc), "hello world");
  });

  it("round-trips multiple lines", () => {
    const original = "line 1\nline 2\nline 3";
    const doc = textToDoc(original);
    assert.equal(docToText(doc), original);
  });

  it("preserves blank lines", () => {
    const original = "top\n\nbottom";
    const doc = textToDoc(original);
    assert.equal(docToText(doc), original);
  });

  it("produces a paragraph per line", () => {
    const doc = textToDoc("one\ntwo");
    let paragraphs = 0;
    doc.forEach((node) => {
      if (node.type.name === "paragraph") paragraphs++;
    });
    assert.equal(paragraphs, 2);
  });

  it("uses the plain text schema", () => {
    const doc = textToDoc("x");
    assert.equal(doc.type.schema, plainTextSchema);
  });

  it("round-trips a trailing newline as an empty final paragraph", () => {
    // A file ending in \n should not lose that trailing line, because that's
    // how the user authored it on disk and how git diffs it. textToDoc
    // splits on \n, so 'foo\n' becomes ['foo', ''] -> 2 paragraphs.
    const original = "foo\n";
    const doc = textToDoc(original);
    assert.equal(docToText(doc), original);
  });

  it("round-trips multiple consecutive blank lines", () => {
    const original = "top\n\n\n\nbottom";
    const doc = textToDoc(original);
    assert.equal(docToText(doc), original);
  });

  it("round-trips a long single line", () => {
    // Single-paragraph stress: no newlines, long content.
    const original = "x".repeat(5000);
    const doc = textToDoc(original);
    assert.equal(docToText(doc), original);
  });

  it("round-trips unicode + emoji content", () => {
    const original = "café 🌸 markdown\n日本語\n";
    const doc = textToDoc(original);
    assert.equal(docToText(doc), original);
  });

  it("treats an empty string as a single empty paragraph", () => {
    const doc = textToDoc("");
    let paragraphs = 0;
    doc.forEach((node) => {
      if (node.type.name === "paragraph") paragraphs++;
    });
    assert.equal(paragraphs, 1);
    assert.equal(doc.firstChild?.content.size, 0);
  });
});
