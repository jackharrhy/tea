import {
  cameraRight,
  copyWaveChannel,
  perspectiveForward,
  traceWorldSegment,
  MapsError,
  type AmbientSoundModulation,
  type ParsedAmbientSound,
  type ParsedEnvSound,
  type ParsedMusicTrack,
  type ParsedWave,
  type ParsedWorld,
  type Vec3Tuple,
} from "../core/index.js";
import type { LoadedSoundAsset, LoadedWorld } from "./assets.js";
import { roomPresetForType, type RoomPreset } from "./room-presets.js";
import {
  goldSrcPlayerSoundPath,
  playerSurfaceMaterial,
} from "./player-sounds.js";
import type { AudioState, CameraState } from "./types.js";

export {
  playerSurfaceMaterial,
  type PlayerSurfaceMaterial,
} from "./player-sounds.js";

export interface AmbientPlaybackState {
  readonly volume: number;
  readonly pitch: number;
}

export interface GoldSrcStereoGains {
  readonly left: number;
  readonly right: number;
}

interface EmitterNodes {
  readonly ambient: ParsedAmbientSound;
  readonly source: AudioBufferSourceNode;
  readonly left: GainNode;
  readonly right: GainNode;
  readonly merger: ChannelMergerNode;
}

interface MusicNodes {
  readonly track: ParsedMusicTrack;
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function envelopeValue(
  start: number,
  end: number,
  authoredSpeed: number,
  elapsedSeconds: number,
  scale: number,
): number {
  if (authoredSpeed <= 0 || start === end) return end;
  const unitsPerSecond = (101 - authoredSpeed) * 1.25;
  const duration =
    (Math.abs(end - start) * scale) / Math.max(0.001, unitsPerSecond);
  return start + (end - start) * clamp(elapsedSeconds / duration, 0, 1);
}

function deterministicRandom(entityIndex: number, cycle: number): number {
  let value = (entityIndex + 1) * 0x9e37_79b1 + cycle * 0x85eb_ca6b;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb_352d);
  value ^= value >>> 15;
  return (value >>> 0) / 0xffff_ffff;
}

function lfoValue(
  modulation: AmbientSoundModulation,
  elapsedSeconds: number,
  entityIndex: number,
): number {
  if (modulation.lfoType === 0 || modulation.lfoRate <= 0) return 128;
  const cyclePosition = (elapsedSeconds * modulation.lfoRate * 5) / 510;
  const phase = cyclePosition - Math.floor(cyclePosition);
  const triangle = phase < 0.5 ? phase * 510 : (1 - phase) * 510;
  if (modulation.lfoType === 1) return triangle < 128 ? 255 : 0;
  if (modulation.lfoType === 3)
    return deterministicRandom(entityIndex, Math.floor(cyclePosition)) * 255;
  return triangle;
}

export function ambientPlaybackState(
  ambient: ParsedAmbientSound,
  elapsedSeconds: number,
): AmbientPlaybackState {
  const modulation = ambient.modulation;
  let volume = envelopeValue(
    modulation.startVolume,
    modulation.runVolume,
    modulation.fadeIn,
    elapsedSeconds,
    100,
  );
  let pitch = envelopeValue(
    modulation.startPitch,
    modulation.runPitch,
    modulation.spinUp,
    elapsedSeconds,
    1,
  );
  const lfo = lfoValue(modulation, elapsedSeconds, ambient.entityIndex) - 128;
  volume += (lfo * modulation.lfoVolume) / 10_000;
  pitch += (lfo * modulation.lfoPitch) / 100;
  return { volume: clamp(volume, 0, 1), pitch: clamp(pitch, 1, 255) };
}

function cameraAxes(camera: CameraState): {
  forward: Vec3Tuple;
  right: Vec3Tuple;
} {
  return {
    forward: perspectiveForward(camera.yaw, camera.pitch),
    right: cameraRight(camera.yaw),
  };
}

export function goldSrcStereoGains(
  listener: Vec3Tuple,
  listenerRight: Vec3Tuple,
  source: Vec3Tuple,
  masterVolume: number,
  attenuation: number,
): GoldSrcStereoGains {
  const x = source[0] - listener[0];
  const y = source[1] - listener[1];
  const z = source[2] - listener[2];
  const distance = Math.hypot(x, y, z);
  const dot =
    attenuation === 0 || distance === 0
      ? 0
      : (listenerRight[0] * x + listenerRight[1] * y + listenerRight[2] * z) /
        distance;
  const distanceScale = clamp(1 - (distance * attenuation) / 1000, 0, 1);
  return {
    left: clamp(masterVolume * distanceScale * (1 - dot), 0, 1),
    right: clamp(masterVolume * distanceScale * (1 + dot), 0, 1),
  };
}

export function selectEnvSoundRoom(
  world: Pick<ParsedWorld, "envSounds" | "trace">,
  listener: Vec3Tuple,
  currentRoomType: number,
): number {
  let closest: ParsedEnvSound | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const envSound of world.envSounds) {
    const distance = Math.hypot(
      listener[0] - envSound.origin[0],
      listener[1] - envSound.origin[1],
      listener[2] - envSound.origin[2],
    );
    if (distance > envSound.radius || distance >= closestDistance) continue;
    const trace = traceWorldSegment(world.trace, envSound.origin, listener);
    if (trace.blocked || trace.crossesWaterBoundary) continue;
    closest = envSound;
    closestDistance = distance;
  }
  return closest?.roomType ?? currentRoomType;
}

function audioBufferFromAsset(
  context: AudioContext,
  asset: LoadedSoundAsset,
): AudioBuffer {
  const wave = asset.wave;
  const buffer = context.createBuffer(1, wave.frameCount, wave.sampleRate);
  const output = buffer.getChannelData(0);
  copyWaveChannel(wave, 0, output);
  if (wave.channels === 2) {
    const second = new Float32Array(wave.frameCount);
    copyWaveChannel(wave, 1, second);
    for (let index = 0; index < output.length; index += 1)
      output[index] = (output[index]! + second[index]!) * 0.5;
  }
  return buffer;
}

export function ambientSoundLoops(
  ambient: Pick<ParsedAmbientSound, "looping">,
  wave: Pick<ParsedWave, "frameCount">,
): boolean {
  return ambient.looping && wave.frameCount > 0;
}

function loopOffset(
  ambient: ParsedAmbientSound,
  asset: LoadedSoundAsset,
  elapsed: number,
): number {
  const wave = asset.wave;
  if (!ambientSoundLoops(ambient, wave)) return 0;
  const loopStart = (wave.loopStartFrame ?? 0) / wave.sampleRate;
  const loopEnd = (wave.loopEndFrame ?? wave.frameCount) / wave.sampleRate;
  if (elapsed < loopEnd) return elapsed;
  return (
    loopStart + ((elapsed - loopStart) % Math.max(0.001, loopEnd - loopStart))
  );
}

export class WorldAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private roomInput: GainNode | null = null;
  private dry: GainNode | null = null;
  private lowpass: BiquadFilterNode | null = null;
  private convolver: ConvolverNode | null = null;
  private roomWet: GainNode | null = null;
  private delay: DelayNode | null = null;
  private delayWet: GainNode | null = null;
  private feedback: GainNode | null = null;
  private loaded: LoadedWorld | null = null;
  private emitters: EmitterNodes[] = [];
  private emittersStarted = false;
  private buffers = new Map<string, AudioBuffer>();
  private musicBuffers = new Map<string, AudioBuffer>();
  private musicNodes: MusicNodes | null = null;
  private musicGeneration = 0;
  private camera: CameraState = {
    position: [0, 0, 0],
    yaw: 0,
    pitch: 0,
    fieldOfView: 75,
  };
  private timer: ReturnType<typeof setInterval> | null = null;
  private mapEpoch = performance.now();
  private runtimeActive = false;
  private enabled = false;
  private muted = false;
  private volume: number;
  private playerVolume: number;
  private musicVolume: number;
  private roomType = 0;
  private playerSoundSequence = 0;
  private disposed = false;

  public constructor(
    volume: number,
    private readonly changed: (state: AudioState) => void,
    playerVolume = 1,
    musicVolume = 1,
    private readonly warning: (message: string) => void = () => undefined,
  ) {
    this.volume = clamp(volume, 0, 1);
    this.playerVolume = clamp(playerVolume, 0, 2);
    this.musicVolume = clamp(musicVolume, 0, 1);
  }

  public get state(): AudioState {
    return {
      enabled: this.enabled,
      suspended: this.context?.state !== "running",
      muted: this.muted,
      volume: this.volume,
      playerVolume: this.playerVolume,
      musicVolume: this.musicVolume,
      musicPlaying: this.musicNodes !== null,
      musicEntityIndex: this.musicNodes?.track.entityIndex ?? null,
      roomType: this.roomType,
    };
  }

  public load(loaded: LoadedWorld): void {
    this.musicGeneration += 1;
    this.stopMusicNodes(false);
    this.stopEmitters();
    this.loaded = loaded;
    this.buffers.clear();
    this.musicBuffers.clear();
    this.mapEpoch = performance.now();
    this.roomType = 0;
    if (this.context) {
      this.startEmitters();
      void this.startAutoMusic().catch((error) => this.reportMusicError(error));
    }
    this.changed(this.state);
  }

  public unload(): void {
    this.musicGeneration += 1;
    this.stopMusicNodes(false);
    this.stopEmitters();
    this.loaded = null;
    this.buffers.clear();
    this.musicBuffers.clear();
    this.roomType = 0;
    this.applyRoomPreset(this.roomType);
    this.changed(this.state);
  }

  public async enable(): Promise<void> {
    if (this.disposed) throw new Error("Maps audio has been disposed");
    this.ensureContext();
    this.enabled = true;
    await this.context!.resume();
    if (!this.emittersStarted) this.startEmitters();
    try {
      await this.startAutoMusic();
    } catch (error) {
      this.reportMusicError(error);
    }
    this.applyMasterGain();
    this.changed(this.state);
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMasterGain();
    this.changed(this.state);
  }

  public setVolume(volume: number): void {
    this.volume = clamp(volume, 0, 1);
    this.applyMasterGain();
    this.changed(this.state);
  }

  public setPlayerVolume(volume: number): void {
    this.playerVolume = clamp(volume, 0, 2);
    this.changed(this.state);
  }

  public setMusicVolume(volume: number): void {
    this.musicVolume = clamp(volume, 0, 1);
    if (this.musicGain) {
      this.musicGain.gain.setTargetAtTime(
        this.musicVolume,
        this.context?.currentTime ?? 0,
        0.025,
      );
    }
    this.changed(this.state);
  }

  public async playMusic(entityIndex?: number): Promise<void> {
    if (this.disposed) throw new Error("Maps audio has been disposed");
    const loaded = this.loaded;
    if (!loaded) throw new Error("No world is loaded");
    const track =
      entityIndex === undefined
        ? loaded.world.musicTracks[0]
        : loaded.world.musicTracks.find(
            (candidate) => candidate.entityIndex === entityIndex,
          );
    if (!track) throw new Error("The requested map music track does not exist");
    await this.enable();
    await this.startMusic(track, false);
  }

  public stopMusic(): void {
    this.musicGeneration += 1;
    this.stopMusicNodes(true);
  }

  public setRuntimeActive(active: boolean): void {
    this.runtimeActive = active;
    this.applyMasterGain();
  }

  public updateCamera(camera: CameraState): void {
    this.camera = camera;
    this.updateListener();
    this.updateEmitters();
    this.updateRoom();
  }

  public playPlayerSound(
    textureName: string,
    _kind: "step" | "jump" | "land",
    strength: number,
  ): void {
    const context = this.context;
    const roomInput = this.roomInput;
    const loaded = this.loaded;
    if (
      !context ||
      !roomInput ||
      !loaded ||
      !this.enabled ||
      !this.runtimeActive ||
      this.muted
    )
      return;
    const material = playerSurfaceMaterial(textureName);
    const path = goldSrcPlayerSoundPath(material, this.playerSoundSequence++);
    const asset = loaded.playerSounds.get(path);
    if (!asset) return;
    let buffer = this.buffers.get(path);
    if (!buffer) {
      buffer = audioBufferFromAsset(context, asset);
      this.buffers.set(path, buffer);
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    const gain = context.createGain();
    gain.gain.value = this.playerVolume * clamp(strength, 0, 1);
    source.connect(gain).connect(roomInput);

    source.addEventListener(
      "ended",
      () => {
        source.disconnect();
        gain.disconnect();
      },
      { once: true },
    );
    source.start();
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.musicGeneration += 1;
    this.stopMusicNodes(false);
    this.stopEmitters();
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const context = this.context;
    this.context = null;
    this.loaded = null;
    this.buffers.clear();
    this.musicBuffers.clear();
    context?.removeEventListener("statechange", this.onContextStateChange);
    if (context && context.state !== "closed") void context.close();
  }

  private ensureContext(): void {
    if (this.context) return;
    if (typeof AudioContext === "undefined") {
      throw new MapsError(
        "audio-unavailable",
        "Maps requires the Web Audio API for sound",
      );
    }
    const context = new AudioContext({ latencyHint: "interactive" });
    this.context = context;
    this.master = context.createGain();
    this.musicGain = context.createGain();
    this.roomInput = context.createGain();
    this.dry = context.createGain();
    this.lowpass = context.createBiquadFilter();
    this.lowpass.type = "lowpass";
    this.convolver = context.createConvolver();
    this.roomWet = context.createGain();
    this.delay = context.createDelay(1);
    this.delayWet = context.createGain();
    this.feedback = context.createGain();

    this.roomInput.connect(this.dry).connect(this.master);
    this.roomInput
      .connect(this.lowpass)
      .connect(this.convolver)
      .connect(this.roomWet)
      .connect(this.master);
    this.roomInput
      .connect(this.delay)
      .connect(this.delayWet)
      .connect(this.master);
    this.delay.connect(this.feedback).connect(this.delay);
    this.musicGain.connect(this.master);
    this.master.connect(context.destination);
    context.addEventListener("statechange", this.onContextStateChange);
    this.applyRoomPreset(0);
    this.musicGain.gain.value = this.musicVolume;
    this.applyMasterGain();
    this.timer = setInterval(() => {
      this.updateEmitters();
      this.updateRoom();
    }, 200);
  }

  private startEmitters(): void {
    const context = this.context;
    const loaded = this.loaded;
    const roomInput = this.roomInput;
    if (
      !context ||
      !loaded ||
      !roomInput ||
      !this.enabled ||
      this.emittersStarted
    )
      return;
    this.emittersStarted = true;
    const elapsed = Math.max(0, (performance.now() - this.mapEpoch) / 1000);
    for (const ambient of loaded.world.ambientSounds) {
      if (!ambient.activeOnLoad) continue;
      const asset = loaded.sounds.get(ambient.reference.normalizedPath);
      if (!asset) continue;
      let buffer = this.buffers.get(ambient.reference.normalizedPath);
      if (!buffer) {
        buffer = audioBufferFromAsset(context, asset);
        this.buffers.set(ambient.reference.normalizedPath, buffer);
      }
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = ambientSoundLoops(ambient, asset.wave);
      if (source.loop) {
        source.loopStart =
          (asset.wave.loopStartFrame ?? 0) / asset.wave.sampleRate;
        source.loopEnd =
          (asset.wave.loopEndFrame ?? asset.wave.frameCount) /
          asset.wave.sampleRate;
      }
      const left = context.createGain();
      const right = context.createGain();
      const merger = context.createChannelMerger(2);
      source.connect(left).connect(merger, 0, 0);
      source.connect(right).connect(merger, 0, 1);
      merger.connect(roomInput);
      const emitter = { ambient, source, left, right, merger };
      this.emitters.push(emitter);
      if (!source.loop) {
        source.addEventListener(
          "ended",
          () => {
            const index = this.emitters.indexOf(emitter);
            if (index >= 0) this.emitters.splice(index, 1);
            source.disconnect();
            left.disconnect();
            right.disconnect();
            merger.disconnect();
          },
          { once: true },
        );
      }
      source.start(context.currentTime, loopOffset(ambient, asset, elapsed));
    }
    this.updateEmitters();
  }

  private stopEmitters(): void {
    for (const emitter of this.emitters) {
      try {
        emitter.source.stop();
      } catch {
        // A source that has already ended is safe to discard.
      }
      emitter.source.disconnect();
      emitter.left.disconnect();
      emitter.right.disconnect();
      emitter.merger.disconnect();
    }
    this.emitters = [];
    this.emittersStarted = false;
  }

  private async startAutoMusic(): Promise<void> {
    if (!this.enabled || this.musicNodes) return;
    const track = this.loaded?.world.musicTracks.find(
      (candidate) => candidate.activeOnLoad,
    );
    if (track) await this.startMusic(track, true);
  }

  private async startMusic(
    track: ParsedMusicTrack,
    catchUp: boolean,
  ): Promise<void> {
    const context = this.context;
    const loaded = this.loaded;
    const musicGain = this.musicGain;
    if (!context || !loaded || !musicGain) return;
    const asset = loaded.music.get(track.reference.normalizedPath);
    if (!asset) {
      throw new MapsError(
        "asset-fetch",
        `music ${track.reference.declaredPath} is not available`,
      );
    }

    const generation = ++this.musicGeneration;
    let buffer = this.musicBuffers.get(track.reference.normalizedPath);
    if (!buffer) {
      try {
        buffer = await context.decodeAudioData(asset.data.slice(0));
      } catch (error) {
        throw new MapsError(
          "audio-unavailable",
          `the browser could not decode music ${track.reference.declaredPath}`,
          { cause: error },
        );
      }
      if (generation !== this.musicGeneration || loaded !== this.loaded) return;
      this.musicBuffers.set(track.reference.normalizedPath, buffer);
    }
    if (generation !== this.musicGeneration || loaded !== this.loaded) return;

    const elapsed = catchUp
      ? Math.max(0, (performance.now() - this.mapEpoch) / 1000)
      : 0;
    if (!track.looping && elapsed >= buffer.duration) return;
    const offset = track.looping
      ? elapsed % Math.max(0.001, buffer.duration)
      : elapsed;
    this.stopMusicNodes(false);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = track.looping;
    const gain = context.createGain();
    gain.gain.value = track.volume;
    source.connect(gain).connect(musicGain);
    const nodes = { track, source, gain };
    this.musicNodes = nodes;
    source.addEventListener(
      "ended",
      () => {
        if (this.musicNodes !== nodes) return;
        this.musicNodes = null;
        source.disconnect();
        gain.disconnect();
        this.changed(this.state);
      },
      { once: true },
    );
    source.start(context.currentTime, offset);
    this.changed(this.state);
  }

  private stopMusicNodes(emit: boolean): void {
    const nodes = this.musicNodes;
    if (!nodes) return;
    this.musicNodes = null;
    try {
      nodes.source.stop();
    } catch {
      // A source that has already ended is safe to discard.
    }
    nodes.source.disconnect();
    nodes.gain.disconnect();
    if (emit) this.changed(this.state);
  }

  private reportMusicError(error: unknown): void {
    this.warning(error instanceof Error ? error.message : String(error));
  }

  private updateListener(): void {
    const context = this.context;
    if (!context) return;
    const now = context.currentTime;
    const { forward } = cameraAxes(this.camera);
    const listener = context.listener;
    listener.positionX.setValueAtTime(this.camera.position[0], now);
    listener.positionY.setValueAtTime(this.camera.position[1], now);
    listener.positionZ.setValueAtTime(this.camera.position[2], now);
    listener.forwardX.setValueAtTime(forward[0], now);
    listener.forwardY.setValueAtTime(forward[1], now);
    listener.forwardZ.setValueAtTime(forward[2], now);
    listener.upX.setValueAtTime(0, now);
    listener.upY.setValueAtTime(0, now);
    listener.upZ.setValueAtTime(1, now);
  }

  private updateEmitters(): void {
    const context = this.context;
    if (!context) return;
    const elapsed = Math.max(0, (performance.now() - this.mapEpoch) / 1000);
    const { right } = cameraAxes(this.camera);
    for (const emitter of this.emitters) {
      const playback = ambientPlaybackState(emitter.ambient, elapsed);
      const gains = goldSrcStereoGains(
        this.camera.position,
        right,
        emitter.ambient.origin,
        playback.volume,
        emitter.ambient.attenuation,
      );
      emitter.left.gain.setTargetAtTime(gains.left, context.currentTime, 0.015);
      emitter.right.gain.setTargetAtTime(
        gains.right,
        context.currentTime,
        0.015,
      );
      emitter.source.playbackRate.setTargetAtTime(
        playback.pitch / 100,
        context.currentTime,
        0.03,
      );
    }
  }

  private updateRoom(): void {
    if (!this.loaded) return;
    const roomType = selectEnvSoundRoom(
      this.loaded.world,
      this.camera.position,
      this.roomType,
    );
    if (roomType === this.roomType) return;
    this.roomType = roomType;
    this.applyRoomPreset(roomType);
    this.changed(this.state);
  }

  private applyRoomPreset(roomType: number): void {
    const context = this.context;
    if (
      !context ||
      !this.dry ||
      !this.lowpass ||
      !this.convolver ||
      !this.roomWet ||
      !this.delay ||
      !this.delayWet ||
      !this.feedback
    )
      return;
    const preset = roomPresetForType(roomType);
    const now = context.currentTime;
    this.dry.gain.setTargetAtTime(preset.dry, now, 0.04);
    this.roomWet.gain.setTargetAtTime(preset.wet, now, 0.04);
    this.lowpass.frequency.setTargetAtTime(preset.lowpass, now, 0.04);
    this.delay.delayTime.setTargetAtTime(preset.delay, now, 0.04);
    this.delayWet.gain.setTargetAtTime(preset.delayWet, now, 0.04);
    this.feedback.gain.setTargetAtTime(preset.feedback, now, 0.04);
    this.convolver.buffer = this.impulseResponse(preset, roomType);
  }

  private impulseResponse(preset: RoomPreset, roomType: number): AudioBuffer {
    const context = this.context!;
    const frames = Math.max(
      1,
      Math.min(
        Math.ceil(context.sampleRate * preset.duration),
        context.sampleRate * 3,
      ),
    );
    const impulse = context.createBuffer(2, frames, context.sampleRate);
    let seed = (roomType + 1) * 0x45d9_f3b;
    for (let channel = 0; channel < 2; channel += 1) {
      const output = impulse.getChannelData(channel);
      for (let index = 0; index < frames; index += 1) {
        seed = Math.imul(seed ^ (seed >>> 16), 0x45d9_f3b);
        seed ^= seed >>> 16;
        const noise = ((seed >>> 0) / 0x7fff_ffff - 1) * 0.7;
        output[index] = noise * Math.pow(1 - index / frames, preset.decay);
      }
    }
    return impulse;
  }

  private applyMasterGain(): void {
    if (!this.context || !this.master) return;
    const gain =
      this.enabled && this.runtimeActive && !this.muted ? this.volume : 0;
    this.master.gain.setTargetAtTime(gain, this.context.currentTime, 0.025);
  }

  private readonly onContextStateChange = (): void => {
    this.changed(this.state);
  };
}
