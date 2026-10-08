// Helpers for the binary wire format used by both server and browser.
//
// Most messages are `[messageType, ...payload]`. File-scoped messages add a
// length-prefixed filename: `[messageType, filenameLen, ...filenameBytes, ...payload]`.
//
// Both sides work with `Uint8Array` so the same code runs in the browser and
// on the uWebSockets server (which delivers `ArrayBuffer`, not Node `Buffer`).

import { MESSAGE_TYPE_RENAME_FILE } from "./message-types.ts";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function encodeMessage(type: number, payload?: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + (payload?.length ?? 0));
  out[0] = type;
  if (payload) out.set(payload, 1);
  return out;
}

export function encodeFileMessage(
  type: number,
  filename: string,
  payload: Uint8Array,
): Uint8Array {
  const filenameBytes = textEncoder.encode(filename);
  if (filenameBytes.length > 0xff) {
    throw new Error(
      `Filename too long for wire format (${filenameBytes.length} bytes)`,
    );
  }
  const out = new Uint8Array(1 + 1 + filenameBytes.length + payload.length);
  out[0] = type;
  out[1] = filenameBytes.length;
  out.set(filenameBytes, 2);
  out.set(payload, 2 + filenameBytes.length);
  return out;
}

export function decodeFileMessage(content: Uint8Array): {
  filename: string;
  payload: Uint8Array;
} {
  const filenameLength = content[0];
  const filename = textDecoder.decode(content.subarray(1, 1 + filenameLength));
  const payload = content.subarray(1 + filenameLength);
  return { filename, payload };
}

export function toUint8(data: ArrayBuffer | Uint8Array | Buffer): Uint8Array {
  if (data instanceof Uint8Array) {
    // Buffer is also a Uint8Array; this also covers Node Buffer.
    return data;
  }
  return new Uint8Array(data);
}

export function decodeUtf8(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

export function encodeUtf8(text: string): Uint8Array {
  return textEncoder.encode(text);
}

export function encodeRenameFrame(
  oldName: string,
  newName: string,
): Uint8Array {
  const oldBytes = textEncoder.encode(oldName);
  const newBytes = textEncoder.encode(newName);
  if (oldBytes.length > 0xff) {
    throw new Error(
      `oldName too long for wire format (${oldBytes.length} bytes)`,
    );
  }
  const out = new Uint8Array(1 + 1 + oldBytes.length + newBytes.length);
  out[0] = MESSAGE_TYPE_RENAME_FILE;
  out[1] = oldBytes.length;
  out.set(oldBytes, 2);
  out.set(newBytes, 2 + oldBytes.length);
  return out;
}

export function decodeRenameFrame(content: Uint8Array): {
  oldName: string;
  newName: string;
} {
  const oldLen = content[0];
  const oldName = textDecoder.decode(content.subarray(1, 1 + oldLen));
  const newName = textDecoder.decode(content.subarray(1 + oldLen));
  return { oldName, newName };
}
