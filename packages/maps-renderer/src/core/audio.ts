import { BinaryView } from "./binary.js";
import { entityValue, type BspEntity } from "./entities.js";
import { invalidData, invariant } from "./errors.js";
import type { Vec3Tuple } from "./types.js";

export interface SoundReference {
  readonly declaredPath: string;
  readonly normalizedPath: string;
  readonly basename: string;
}

export type AmbientLfoType = 0 | 1 | 2 | 3;

export interface AmbientSoundModulation {
  readonly preset: number;
  readonly runVolume: number;
  readonly startVolume: number;
  readonly runPitch: number;
  readonly startPitch: number;
  readonly spinUp: number;
  readonly spinDown: number;
  readonly fadeIn: number;
  readonly fadeOut: number;
  readonly lfoType: AmbientLfoType;
  readonly lfoRate: number;
  readonly lfoPitch: number;
  readonly lfoVolume: number;
  readonly incrementalSpinUp: number;
}

export interface ParsedAmbientSound {
  readonly entityIndex: number;
  readonly reference: SoundReference;
  readonly origin: Vec3Tuple;
  readonly attenuation: number;
  readonly looping: boolean;
  readonly startSilent: boolean;
  readonly activeOnLoad: boolean;
  readonly modulation: AmbientSoundModulation;
}

export interface ParsedEnvSound {
  readonly entityIndex: number;
  readonly origin: Vec3Tuple;
  readonly radius: number;
  readonly roomType: number;
}

/** A Sven Co-op `ambient_music` entity, kept separate from positional GoldSrc sound emitters. */
export interface ParsedMusicTrack {
  readonly entityIndex: number;
  readonly reference: SoundReference;
  readonly volume: number;
  readonly startSilent: boolean;
  readonly looping: boolean;
  readonly activatorOnly: boolean;
  readonly activeOnLoad: boolean;
  readonly targetName: string | null;
}

export interface ParsedWave {
  readonly sampleRate: number;
  readonly channels: 1 | 2;
  readonly bitsPerSample: 8 | 16;
  readonly frameCount: number;
  readonly loopStartFrame: number | null;
  readonly loopEndFrame: number | null;
  readonly pcm: Uint8Array;
}

function integerValue(
  entity: BspEntity,
  key: string,
  fallback: number,
): number {
  const parsed = Number.parseInt(entityValue(entity, key) ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numberValue(entity: BspEntity, key: string, fallback: number): number {
  const parsed = Number(entityValue(entity, key));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function vectorValue(entity: BspEntity, key: string): Vec3Tuple {
  const parts = (entityValue(entity, key) ?? "")
    .trim()
    .split(/\s+/)
    .map(Number);
  if (
    parts.length < 3 ||
    parts.slice(0, 3).some((part) => !Number.isFinite(part))
  )
    return [0, 0, 0];
  return [parts[0]!, parts[1]!, parts[2]!];
}

export function soundReference(path: string): SoundReference | undefined {
  const declaredPath = path
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/(^|\/)\*(?=[^/])/, "$1");
  if (!declaredPath || declaredPath.startsWith("!")) return undefined;
  const parts = declaredPath
    .split("/")
    .filter((part) => part !== "" && part !== ".");
  if (parts.length === 0 || parts.some((part) => part === ".."))
    return undefined;
  const normalizedPath = parts.join("/").toLowerCase();
  const basename = parts.at(-1)?.toLowerCase();
  if (!basename) return undefined;
  return { declaredPath: parts.join("/"), normalizedPath, basename };
}

function ambientModulation(entity: BspEntity): AmbientSoundModulation {
  // Preserve the authored preset ID for diagnostics. Numbered preset behavior is intentionally
  // not inferred here; explicit entity modulation keys remain portable and deterministic.
  const presetNumber = Math.max(0, integerValue(entity, "preset", 0));
  const runPitch = clamp(integerValue(entity, "pitch", 100), 0, 255) || 100;
  const startPitch =
    clamp(integerValue(entity, "pitchstart", runPitch), 0, 255) || 100;
  return {
    preset: presetNumber,
    runVolume: clamp(numberValue(entity, "health", 10), 0, 10) / 10,
    startVolume: clamp(integerValue(entity, "volstart", 0), 0, 10) / 10,
    runPitch,
    startPitch,
    spinUp: clamp(integerValue(entity, "spinup", 0), 0, 100),
    spinDown: clamp(integerValue(entity, "spindown", 0), 0, 100),
    fadeIn: clamp(integerValue(entity, "fadein", 0), 0, 100),
    fadeOut: clamp(integerValue(entity, "fadeout", 0), 0, 100),
    lfoType: clamp(integerValue(entity, "lfotype", 0), 0, 3) as AmbientLfoType,
    lfoRate: clamp(integerValue(entity, "lforate", 0), 0, 1000),
    lfoPitch: clamp(integerValue(entity, "lfomodpitch", 0), 0, 100),
    lfoVolume: clamp(integerValue(entity, "lfomodvol", 0), 0, 100),
    incrementalSpinUp: clamp(integerValue(entity, "cspinup", 0), 0, 100),
  };
}

export function parseGoldSrcAudioEntities(entities: readonly BspEntity[]): {
  ambientSounds: ParsedAmbientSound[];
  envSounds: ParsedEnvSound[];
  musicTracks: ParsedMusicTrack[];
} {
  const ambientSounds: ParsedAmbientSound[] = [];
  const envSounds: ParsedEnvSound[] = [];
  const musicTracks: ParsedMusicTrack[] = [];
  entities.forEach((entity, entityIndex) => {
    const classname = entityValue(entity, "classname")?.toLowerCase();
    if (classname === "ambient_generic") {
      const reference = soundReference(entityValue(entity, "message") ?? "");
      if (!reference) return;
      const spawnFlags = integerValue(entity, "spawnflags", 0);
      const attenuation =
        spawnFlags & 1 ? 0 : spawnFlags & 2 ? 2 : spawnFlags & 4 ? 1.25 : 0.8;
      const startSilent = (spawnFlags & 16) !== 0;
      const looping = (spawnFlags & 32) === 0;
      ambientSounds.push({
        entityIndex,
        reference,
        origin: vectorValue(entity, "origin"),
        attenuation,
        looping,
        startSilent,
        activeOnLoad: looping && !startSilent,
        modulation: ambientModulation(entity),
      });
    } else if (classname === "env_sound") {
      const radius = Math.max(0, numberValue(entity, "radius", 0));
      const roomType = clamp(integerValue(entity, "roomtype", 0), 0, 28);
      if (radius > 0 && roomType > 0) {
        envSounds.push({
          entityIndex,
          origin: vectorValue(entity, "origin"),
          radius,
          roomType,
        });
      }
    } else if (classname === "ambient_music") {
      const reference = soundReference(entityValue(entity, "message") ?? "");
      if (!reference) return;
      const spawnFlags = integerValue(entity, "spawnflags", 0);
      const startSilent = (spawnFlags & 1) !== 0;
      musicTracks.push({
        entityIndex,
        reference,
        volume: clamp(numberValue(entity, "volume", 10), 0, 10) / 10,
        startSilent,
        looping: (spawnFlags & 2) !== 0,
        activatorOnly: (spawnFlags & 4) !== 0,
        activeOnLoad: !startSilent,
        targetName: entityValue(entity, "targetname")?.trim() || null,
      });
    }
  });
  return { ambientSounds, envSounds, musicTracks };
}

function fourCc(bytes: BinaryView, offset: number): string {
  return bytes.string(offset, 4, false);
}

function chunkRanges(
  bytes: BinaryView,
  end: number,
): Array<{ id: string; offset: number; size: number }> {
  const chunks: Array<{ id: string; offset: number; size: number }> = [];
  let offset = 12;
  while (offset + 8 <= end) {
    const id = fourCc(bytes, offset);
    const size = bytes.u32(offset + 4);
    const payload = offset + 8;
    bytes.require(payload, size, `WAV ${id} chunk`);
    chunks.push({ id, offset: payload, size });
    offset = payload + size + (size & 1);
  }
  invariant(
    offset === end || offset === end + 1,
    "WAV has trailing partial chunk data",
  );
  return chunks;
}

export function parseWave(source: ArrayBuffer | ArrayBufferView): ParsedWave {
  const bytes = new BinaryView(source);
  bytes.require(0, 12, "WAV header");
  invariant(
    fourCc(bytes, 0) === "RIFF" && fourCc(bytes, 8) === "WAVE",
    "unsupported WAV header",
  );
  const declaredEnd = bytes.u32(4) + 8;
  invariant(
    declaredEnd >= 12 && declaredEnd <= bytes.byteLength,
    "WAV RIFF size is invalid",
  );
  const chunks = chunkRanges(bytes, declaredEnd);
  const formatChunk = chunks.find((chunk) => chunk.id === "fmt ");
  const dataChunk = chunks.find((chunk) => chunk.id === "data");
  invariant(formatChunk !== undefined, "WAV is missing its fmt chunk");
  invariant(dataChunk !== undefined, "WAV is missing its data chunk");
  invariant(formatChunk.size >= 16, "WAV fmt chunk is too small");
  const format = bytes.u16(formatChunk.offset);
  const channels = bytes.u16(formatChunk.offset + 2);
  const sampleRate = bytes.u32(formatChunk.offset + 4);
  const blockAlign = bytes.u16(formatChunk.offset + 12);
  const bitsPerSample = bytes.u16(formatChunk.offset + 14);
  invariant(
    format === 1,
    `unsupported WAV format ${format}; only PCM is supported`,
  );
  invariant(
    channels === 1 || channels === 2,
    `unsupported WAV channel count ${channels}`,
  );
  invariant(
    bitsPerSample === 8 || bitsPerSample === 16,
    `unsupported WAV sample width ${bitsPerSample}`,
  );
  invariant(
    sampleRate > 0 && sampleRate <= 384_000,
    `invalid WAV sample rate ${sampleRate}`,
  );
  const expectedBlockAlign = channels * (bitsPerSample / 8);
  invariant(
    blockAlign === expectedBlockAlign,
    "WAV block alignment does not match its format",
  );
  invariant(
    dataChunk.size % blockAlign === 0,
    "WAV data contains a partial sample frame",
  );
  const frameCount = dataChunk.size / blockAlign;
  invariant(frameCount > 0, "WAV contains no sample frames");

  let loopStartFrame: number | null = null;
  let loopEndFrame: number | null = null;
  const sampleChunk = chunks.find((chunk) => chunk.id === "smpl");
  if (
    sampleChunk &&
    sampleChunk.size >= 60 &&
    bytes.u32(sampleChunk.offset + 28) > 0
  ) {
    loopStartFrame = bytes.u32(sampleChunk.offset + 44);
    loopEndFrame = bytes.u32(sampleChunk.offset + 48) + 1;
  } else {
    const cueChunk = chunks.find((chunk) => chunk.id === "cue ");
    if (cueChunk && cueChunk.size >= 28 && bytes.u32(cueChunk.offset) > 0) {
      loopStartFrame = bytes.u32(cueChunk.offset + 24);
      loopEndFrame = frameCount;
      const listChunk = chunks.find((chunk) => chunk.id === "LIST");
      if (
        listChunk &&
        listChunk.size >= 12 &&
        fourCc(bytes, listChunk.offset) === "adtl"
      ) {
        let offset = listChunk.offset + 4;
        const end = listChunk.offset + listChunk.size;
        while (offset + 8 <= end) {
          const id = fourCc(bytes, offset);
          const size = bytes.u32(offset + 4);
          const payload = offset + 8;
          if (payload + size > end)
            invalidData("WAV LIST subchunk exceeds its parent chunk");
          if (id === "ltxt" && size >= 8) {
            loopEndFrame = loopStartFrame + bytes.u32(payload + 4);
            break;
          }
          offset = payload + size + (size & 1);
        }
      }
    }
  }
  if (
    loopStartFrame === null ||
    loopEndFrame === null ||
    loopStartFrame < 0 ||
    loopEndFrame <= loopStartFrame ||
    loopEndFrame > frameCount
  ) {
    loopStartFrame = null;
    loopEndFrame = null;
  }

  return {
    sampleRate,
    channels: channels as 1 | 2,
    bitsPerSample: bitsPerSample as 8 | 16,
    frameCount,
    loopStartFrame,
    loopEndFrame,
    pcm: bytes.uint8Array(dataChunk.offset, dataChunk.size).slice(),
  };
}

export function copyWaveChannel(
  wave: ParsedWave,
  channel: number,
  target: Float32Array,
): void {
  invariant(
    channel >= 0 && channel < wave.channels,
    `WAV channel ${channel} is out of range`,
  );
  invariant(
    target.length >= wave.frameCount,
    "WAV destination channel is too small",
  );
  const bytesPerSample = wave.bitsPerSample / 8;
  const frameStride = bytesPerSample * wave.channels;
  if (wave.bitsPerSample === 8) {
    for (let frame = 0; frame < wave.frameCount; frame += 1) {
      target[frame] = (wave.pcm[frame * frameStride + channel]! - 128) / 128;
    }
    return;
  }
  const view = new DataView(
    wave.pcm.buffer,
    wave.pcm.byteOffset,
    wave.pcm.byteLength,
  );
  for (let frame = 0; frame < wave.frameCount; frame += 1) {
    target[frame] =
      view.getInt16(frame * frameStride + channel * 2, true) / 32_768;
  }
}
