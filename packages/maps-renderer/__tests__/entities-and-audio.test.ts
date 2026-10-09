import { describe, expect, it } from "vitest";

import {
  copyWaveChannel,
  parseBsp,
  parseEntities,
  parseWave,
  soundReference,
  spriteReference,
} from "../src/core/index.js";
import {
  ambientSoundLoops,
  ambientPlaybackState,
  goldSrcStereoGains,
  playerSurfaceMaterial,
} from "../src/viewer/audio.js";
import { roomPresetForType } from "../src/viewer/room-presets.js";

import { makeBsp, makeWave } from "./fixtures.js";

describe("entities", () => {
  it("preserves duplicate keys in source order", () => {
    expect(parseEntities('{ "key" "first" "key" "second" }')).toEqual([
      { key: ["first", "second"] },
    ]);
  });

  it("normalizes declared WAD basenames without inventing a hosted layout", () => {
    const world = parseBsp(makeBsp());
    expect(world.wadReferences).toEqual([
      { declaredPath: "C:/games/valve/fixture.wad", basename: "fixture.wad" },
      { declaredPath: "custom.wad", basename: "custom.wad" },
    ]);
  });

  it("normalizes asset references and rejects parent traversal", () => {
    expect(soundReference("Ambience\\Wind.wav")).toMatchObject({
      declaredPath: "Ambience/Wind.wav",
      normalizedPath: "ambience/wind.wav",
    });
    expect(soundReference("*lobby/duvet.wav")).toMatchObject({
      declaredPath: "lobby/duvet.wav",
      normalizedPath: "lobby/duvet.wav",
    });
    expect(spriteReference("/Sprites\\Glow.spr")).toMatchObject({
      declaredPath: "Sprites/Glow.spr",
      normalizedPath: "sprites/glow.spr",
    });
    expect(soundReference("../outside.wav")).toBeUndefined();
    expect(spriteReference("sprites/../outside.spr")).toBeUndefined();
  });

  it("normalizes GoldSrc ambient and room-sound entities", () => {
    const world = parseBsp(
      makeBsp({
        entityText:
          '{ "classname" "worldspawn" }\n{ "classname" "ambient_generic" "message" "Ambience\\Hum.wav" "origin" "1 2 3" "health" "5" "pitch" "120" "spawnflags" "2" }\n{ "classname" "env_sound" "origin" "4 5 6" "radius" "256" "roomtype" "7" }',
      }),
    );
    expect(world.ambientSounds[0]).toMatchObject({
      origin: [1, 2, 3],
      attenuation: 2,
      looping: true,
      activeOnLoad: true,
      reference: {
        declaredPath: "Ambience/Hum.wav",
        normalizedPath: "ambience/hum.wav",
      },
      modulation: { runVolume: 0.5, runPitch: 120 },
    });
    expect(world.envSounds[0]).toMatchObject({
      origin: [4, 5, 6],
      radius: 256,
      roomType: 7,
    });
  });

  it("retains numbered ambient preset IDs without inferring their modulation", () => {
    const world = parseBsp(
      makeBsp({
        entityText:
          '{ "classname" "worldspawn" }\n{ "classname" "ambient_generic" "message" "machine.wav" "spawnflags" "48" "preset" "27" }',
      }),
    );
    expect(world.ambientSounds[0]).toMatchObject({
      startSilent: true,
      looping: false,
      activeOnLoad: false,
      modulation: { preset: 27, runPitch: 100, startPitch: 100, lfoType: 0 },
    });
  });

  it("normalizes Sven Co-op music flags without treating music as a spatial emitter", () => {
    const world = parseBsp(
      makeBsp({
        entityText:
          '{ "classname" "worldspawn" }\n{ "classname" "ambient_music" "message" "Music\\Track.mp3" "volume" "7" "spawnflags" "3" "targetname" "bgm_main" }',
      }),
    );
    expect(world.musicTracks[0]).toEqual({
      entityIndex: 1,
      reference: {
        declaredPath: "Music/Track.mp3",
        normalizedPath: "music/track.mp3",
        basename: "track.mp3",
      },
      volume: 0.7,
      startSilent: true,
      looping: true,
      activatorOnly: false,
      activeOnLoad: false,
      targetName: "bgm_main",
    });
    expect(world.ambientSounds).toHaveLength(0);
  });
});

describe("GoldSrc WAV and spatial audio", () => {
  it("decodes 8-bit PCM and retains cue/LIST loop points", () => {
    const wave = parseWave(
      makeWave({ frames: [0, 128, 255, 64], loopStart: 1, loopLength: 2 }),
    );
    const samples = new Float32Array(wave.frameCount);
    copyWaveChannel(wave, 0, samples);
    expect(wave).toMatchObject({
      sampleRate: 22_050,
      channels: 1,
      bitsPerSample: 8,
      loopStartFrame: 1,
      loopEndFrame: 3,
    });
    expect([...samples]).toEqual([-1, 0, 127 / 128, -0.5]);
  });

  it("decodes signed 16-bit stereo channels", () => {
    const wave = parseWave(
      makeWave({
        bitsPerSample: 16,
        channels: 2,
        frames: [-32_768, 0, 16_384],
      }),
    );
    const samples = new Float32Array(wave.frameCount);
    copyWaveChannel(wave, 1, samples);
    expect([...samples]).toEqual([-1, 0, 0.5]);
  });

  it("retains standard WAV sample-loop boundaries", () => {
    expect(parseWave(makeWave({ sampleLoop: [1, 3] }))).toMatchObject({
      loopStartFrame: 1,
      loopEndFrame: 3,
    });
  });

  it("uses an ambient entity loop even when the WAV has no explicit loop range", () => {
    const looped = parseWave(makeWave({ sampleLoop: [1, 3] }));
    const oneShot = parseWave(makeWave());
    expect(ambientSoundLoops({ looping: true }, looped)).toBe(true);
    expect(ambientSoundLoops({ looping: true }, oneShot)).toBe(true);
    expect(ambientSoundLoops({ looping: false }, looped)).toBe(false);
    expect(ambientSoundLoops({ looping: false }, oneShot)).toBe(false);
  });

  it("evaluates authored startup envelopes and classic stereo attenuation", () => {
    const world = parseBsp(
      makeBsp({
        entityText:
          '{ "classname" "worldspawn" }\n{ "classname" "ambient_generic" "message" "hum.wav" "health" "10" "volstart" "0" "fadein" "1" "spawnflags" "2" }',
      }),
    );
    const ambient = world.ambientSounds[0]!;
    expect(ambientPlaybackState(ambient, 0).volume).toBe(0);
    expect(ambientPlaybackState(ambient, 1).volume).toBe(1);
    expect(
      goldSrcStereoGains([0, 0, 0], [0, -1, 0], [0, -100, 0], 1, 0.8),
    ).toEqual({
      left: 0,
      right: 1,
    });
  });

  it("groups all numbered room types into audible approximate DSP presets", () => {
    expect(roomPresetForType(0)).toMatchObject({ dry: 1, wet: 0 });
    expect(roomPresetForType(6).wet).toBeGreaterThan(0);
    expect(roomPresetForType(15).lowpass).toBeLessThan(1_000);
    expect(roomPresetForType(24).duration).toBeGreaterThan(1);
  });

  it("classifies common GoldSrc texture names for player sample families", () => {
    expect([
      playerSurfaceMaterial("future_vent"),
      playerSurfaceMaterial("steel"),
      playerSurfaceMaterial("trrm_wood2"),
      playerSurfaceMaterial("-0out_dirt2"),
      playerSurfaceMaterial("court_tile"),
      playerSurfaceMaterial("acid_brick3"),
    ]).toEqual(["grate", "metal", "wood", "dirt", "tile", "concrete"]);
  });
});
