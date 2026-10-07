import type { ParsedWorld } from "../core/index.js";

const FNV_OFFSET = 0x811c_9dc5;
const FNV_PRIME = 0x0100_0193;

function mixByte(hash: number, value: number): number {
  return Math.imul(hash ^ value, FNV_PRIME) >>> 0;
}

function mixString(hash: number, value: string): number {
  const bytes = new TextEncoder().encode(value);
  for (const byte of bytes) hash = mixByte(hash, byte);
  return hash;
}

function mixNumber(hash: number, value: number, integer: boolean): number {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  if (integer) view.setInt32(0, value, true);
  else view.setFloat64(0, value, true);
  const length = integer ? 4 : 8;
  for (let index = 0; index < length; index += 1)
    hash = mixByte(hash, bytes[index]!);
  return hash;
}

/** Detects stale walkability sidecars; does not authenticate map data. */
export function walkabilityWorldFingerprint(world: ParsedWorld): string {
  let hash = mixString(FNV_OFFSET, `${world.format}:${world.version}`);
  for (const value of [...world.bounds.min, ...world.bounds.max])
    hash = mixNumber(hash, value, false);
  hash = mixNumber(hash, world.vertices.length, true);
  hash = mixNumber(hash, world.indices.length, true);
  const collision = world.collision;
  if (collision) {
    for (const value of collision.planes) hash = mixNumber(hash, value, false);
    for (const value of collision.clipnodes)
      hash = mixNumber(hash, value, true);
  }
  for (const model of world.models) {
    for (const value of [...model.bounds.min, ...model.bounds.max]) {
      hash = mixNumber(hash, value, false);
    }
    for (const headnode of model.headnodes)
      hash = mixNumber(hash, headnode, true);
    hash = mixByte(hash, model.collidable ? 1 : 0);
  }
  for (const entity of world.entities) {
    for (const key of Object.keys(entity).toSorted()) {
      hash = mixString(hash, key);
      const value = entity[key];
      if (value === undefined) continue;
      for (const part of Array.isArray(value) ? value : [value])
        hash = mixString(hash, part);
    }
  }
  return `wv1-${hash.toString(16).padStart(8, "0")}`;
}
