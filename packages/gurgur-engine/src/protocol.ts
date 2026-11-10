import { PROTOCOL_VERSION } from "./config";
import type { LifecycleMessage, RuntimeEntityRef } from "./world";

export const LIFECYCLE_TAG = 3;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeLifecycle(message: LifecycleMessage): ArrayBuffer {
  return encodeTaggedJson(LIFECYCLE_TAG, message);
}

export function decodeLifecycle(
  bytes: ArrayBuffer | ArrayBufferView,
): LifecycleMessage {
  const value = decodeTaggedJson(bytes, LIFECYCLE_TAG);
  if (
    !isObject(value) ||
    value.type !== "lifecycle" ||
    value.protocolVersion !== PROTOCOL_VERSION ||
    !Number.isSafeInteger(value.worldEpoch) ||
    !Array.isArray(value.created) ||
    !value.created.every(isRuntimeEntityRef) ||
    !Array.isArray(value.removed) ||
    !value.removed.every(isRuntimeId)
  ) {
    throw new Error("invalid lifecycle packet");
  }
  return value as LifecycleMessage;
}

function encodeTaggedJson(tag: number, value: unknown): ArrayBuffer {
  const payload = encoder.encode(JSON.stringify(value));
  const bytes = new Uint8Array(payload.byteLength + 1);
  bytes[0] = tag;
  bytes.set(payload, 1);
  return bytes.buffer;
}

function decodeTaggedJson(
  bytes: ArrayBuffer | ArrayBufferView,
  expectedTag: number,
): unknown {
  const view =
    bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 2 || view[0] !== expectedTag)
    throw new Error("unknown binary packet tag");
  return JSON.parse(decoder.decode(view.subarray(1)));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRuntimeId(value: unknown): boolean {
  return (
    isObject(value) &&
    Number.isSafeInteger(value.index) &&
    Number.isSafeInteger(value.generation)
  );
}

function isRuntimeEntityRef(value: unknown): value is RuntimeEntityRef {
  return (
    isObject(value) &&
    isRuntimeId(value.id) &&
    (value.ownerPlayerId === null || isRuntimeId(value.ownerPlayerId)) &&
    Number.isSafeInteger(value.authorityVersion) &&
    value.transferPolicy === "fixed" &&
    (value.kind === "player" ||
      (value.kind === "world-entity" &&
        Number.isSafeInteger(value.entityIndex)))
  );
}
