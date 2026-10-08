import * as assert from "remix/assert";
import { describe, it } from "remix/test";

import {
  decodeFileMessage,
  decodeRenameFrame,
  decodeUtf8,
  encodeFileMessage,
  encodeMessage,
  encodeRenameFrame,
  encodeUtf8,
  toUint8,
} from "../app/shared/wire.ts";

describe("wire format", () => {
  it("encodes a tagged frame", () => {
    const frame = encodeMessage(7, new Uint8Array([1, 2, 3]));
    assert.deepEqual(Array.from(frame), [7, 1, 2, 3]);
  });

  it("encodes a tagged frame with no payload", () => {
    const frame = encodeMessage(2);
    assert.deepEqual(Array.from(frame), [2]);
  });

  it("round-trips a file-scoped frame", () => {
    const payload = new Uint8Array([10, 20, 30, 40]);
    const frame = encodeFileMessage(5, "notes.md", payload);

    assert.equal(frame[0], 5);
    const { filename, payload: decoded } = decodeFileMessage(frame.subarray(1));
    assert.equal(filename, "notes.md");
    assert.deepEqual(Array.from(decoded), Array.from(payload));
  });

  it("round-trips utf-8 strings", () => {
    const text = "café 🌸 markdown";
    assert.equal(decodeUtf8(encodeUtf8(text)), text);
  });

  it("rejects filenames longer than 255 bytes", () => {
    const long = "x".repeat(300) + ".md";
    assert.throws(
      () => encodeFileMessage(5, long, new Uint8Array(0)),
      /Filename too long/,
    );
  });

  it("toUint8 passes through Uint8Array unchanged", () => {
    const u = new Uint8Array([1, 2, 3]);
    assert.equal(toUint8(u), u);
  });

  it("toUint8 wraps an ArrayBuffer", () => {
    const buf = new Uint8Array([1, 2, 3]).buffer;
    const out = toUint8(buf);
    assert.ok(out instanceof Uint8Array);
    assert.deepEqual(Array.from(out), [1, 2, 3]);
  });

  it("round-trips a rename frame", () => {
    const frame = encodeRenameFrame("Jack.md", "Jack-Arthur.md");
    assert.equal(frame[0], 7);
    const { oldName, newName } = decodeRenameFrame(frame.subarray(1));
    assert.equal(oldName, "Jack.md");
    assert.equal(newName, "Jack-Arthur.md");
  });

  it("rejects rename frames with oldName longer than 255 bytes", () => {
    const long = "x".repeat(300) + ".md";
    assert.throws(
      () => encodeRenameFrame(long, "short.md"),
      /oldName too long/,
    );
  });
});
