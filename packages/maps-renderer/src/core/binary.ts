import { invalidData, invariant } from "./errors.js";

type BufferInput = ArrayBuffer | ArrayBufferView;

export class BinaryView {
  public readonly bytes: Uint8Array;
  public readonly view: DataView;

  public constructor(input: BufferInput) {
    this.bytes =
      input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    this.view = new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset,
      this.bytes.byteLength,
    );
  }

  public get byteLength(): number {
    return this.bytes.byteLength;
  }

  public require(offset: number, length: number, label = "binary range"): void {
    invariant(
      Number.isSafeInteger(offset) && Number.isSafeInteger(length),
      `${label} is not integral`,
    );
    invariant(offset >= 0 && length >= 0, `${label} is negative`);
    invariant(
      offset + length <= this.byteLength,
      `${label} exceeds its source buffer`,
    );
  }

  public slice(offset: number, length = this.byteLength - offset): BinaryView {
    this.require(offset, length);
    return new BinaryView(this.bytes.subarray(offset, offset + length));
  }

  public u8(offset: number): number {
    this.require(offset, 1);
    return this.view.getUint8(offset);
  }

  public u16(offset: number): number {
    this.require(offset, 2);
    return this.view.getUint16(offset, true);
  }

  public i16(offset: number): number {
    this.require(offset, 2);
    return this.view.getInt16(offset, true);
  }

  public u32(offset: number): number {
    this.require(offset, 4);
    return this.view.getUint32(offset, true);
  }

  public i32(offset: number): number {
    this.require(offset, 4);
    return this.view.getInt32(offset, true);
  }

  public f32(offset: number): number {
    this.require(offset, 4);
    return this.view.getFloat32(offset, true);
  }

  public uint8Array(offset = 0, length = this.byteLength - offset): Uint8Array {
    this.require(offset, length);
    return this.bytes.subarray(offset, offset + length);
  }

  public uint16Array(
    offset = 0,
    count = (this.byteLength - offset) / 2,
  ): Uint16Array {
    this.require(offset, count * 2);
    if ((this.bytes.byteOffset + offset) % 2 !== 0)
      invalidData("unaligned uint16 array");
    return new Uint16Array(
      this.bytes.buffer,
      this.bytes.byteOffset + offset,
      count,
    );
  }

  public int32Array(
    offset = 0,
    count = (this.byteLength - offset) / 4,
  ): Int32Array {
    this.require(offset, count * 4);
    if ((this.bytes.byteOffset + offset) % 4 !== 0)
      invalidData("unaligned int32 array");
    return new Int32Array(
      this.bytes.buffer,
      this.bytes.byteOffset + offset,
      count,
    );
  }

  public float32Array(
    offset = 0,
    count = (this.byteLength - offset) / 4,
  ): Float32Array {
    this.require(offset, count * 4);
    if ((this.bytes.byteOffset + offset) % 4 !== 0)
      invalidData("unaligned float32 array");
    return new Float32Array(
      this.bytes.buffer,
      this.bytes.byteOffset + offset,
      count,
    );
  }

  public string(
    offset: number,
    length: number,
    nullTerminated = false,
  ): string {
    this.require(offset, length);
    let end = offset + length;
    if (nullTerminated) {
      const nullIndex = this.bytes.indexOf(0, offset);
      if (nullIndex >= offset && nullIndex < end) end = nullIndex;
    }
    return new TextDecoder("windows-1252").decode(
      this.bytes.subarray(offset, end),
    );
  }
}

export function asArrayBuffer(
  input: ArrayBuffer | ArrayBufferView,
): ArrayBuffer {
  const bytes =
    input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  return bytes.slice().buffer;
}
