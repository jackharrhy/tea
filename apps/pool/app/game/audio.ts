import type { Snapshot } from "@tea/pool-protocol";
import type { PoolSound } from "@tea/pool";
import { TABLES } from "@tea/pool-simulation/geometry";
import {
  AudioEventGate,
  consumeHeard,
  impactMix,
  spatialMix,
  rollingMix,
  MAX_ROLLING_VOICES,
  MAX_IMPACT_VOICES,
  MAX_VOICES,
  type PredictionContext,
  type HeardSound,
} from "./audio-mix";

type Point = { x: number; y: number; z: number };
type Voice = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  filter: BiquadFilterNode;
  pan: PannerNode;
  dry: GainNode;
  spatial: GainNode;
  point: Point;
  level: number;
  rolling: boolean;
};

export class GameAudio {
  enabled = false;
  onError: ((message: string) => void) | null = null;
  private disposed = false;
  private readonly abort = new AbortController();
  private audio: AudioContext | null = null;
  private master: GainNode | null = null;
  private loading: Promise<void> | null = null;
  private impact: AudioBuffer | null = null;
  private impactDry: AudioBuffer | null = null;
  private lastImpactDry = false;
  private cue: AudioBuffer | null = null;
  private cueCloth: AudioBuffer | null = null;
  private lastCueCloth = false;
  private cabinet: AudioBuffer | null = null;
  private pocket: AudioBuffer | null = null;
  private felt: AudioBuffer | null = null;
  private rolling: AudioBuffer | null = null;
  private feltRolling: AudioBuffer | null = null;
  private loops = new Map<string, Voice>();
  private lastObserve = -Infinity;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private voices = new Set<Voice>();
  private events = new AudioEventGate();
  private prediction: PredictionContext | null = null;
  private pose = {
    pos: { x: 0, y: 1.5, z: 0 },
    forward: { x: 0, y: 0, z: -1 },
    up: { x: 0, y: 1, z: 0 },
  };

  toggle() {
    if (this.disposed) return false;
    this.enabled = !this.enabled;
    if (this.enabled) void this.resume();
    else this.stopAll();
    return this.enabled;
  }

  private report(error: unknown) {
    if (this.disposed) return;
    const message = `Audio unavailable: ${error instanceof Error ? error.message : String(error)}`;
    console.warn(message);
    this.onError?.(message);
  }

  async resume() {
    if (!this.enabled || this.disposed) return;
    try {
      if (!this.audio) {
        this.audio = new AudioContext();
        this.master = this.audio.createGain();
        this.master.gain.value = 0.65;
        const compressor = this.audio.createDynamicsCompressor();
        compressor.threshold.value = -10;
        compressor.knee.value = 8;
        compressor.ratio.value = 8;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.12;
        this.master.connect(compressor).connect(this.audio.destination);
        this.updateListener(this.pose.pos, this.pose.forward, this.pose.up);
        this.watchdog = setInterval(() => {
          if (performance.now() - this.lastObserve > 500) this.stopLoops();
        }, 250);
      }
      // Call resume in the gesture stack, before waiting for fetch/decode.
      const resumed = this.audio.resume();
      if (!this.loading) {
        const context = this.audio;
        this.loading = Promise.all(
          [
            "impact.wav",
            "pocket.wav",
            "cue.wav",
            "return.wav",
            "felt.wav",
            "rolling-loop.wav",
            "felt-roll.wav",
            "impact-dry.wav",
            "cue-cloth.wav",
          ].map(async (name) => {
            const response = await fetch(`/audio/${name}`, {
              signal: this.abort.signal,
            });
            if (!response.ok)
              throw new Error(`${name}: HTTP ${response.status}`);
            return context.decodeAudioData(await response.arrayBuffer());
          }),
        )
          .then(
            ([
              impact,
              pocket,
              cue,
              cabinet,
              felt,
              rolling,
              feltRolling,
              impactDry,
              cueCloth,
            ]) => {
              if (this.audio !== context) return;
              this.impact = impact;
              this.impactDry = impactDry;
              this.pocket = pocket;
              this.felt = felt;
              this.rolling = rolling;
              this.feltRolling = feltRolling;
              this.cue = cue;
              this.cueCloth = cueCloth;
              this.cabinet = cabinet;
            },
          )
          .catch((error) => {
            if (this.audio === context) this.loading = null;
            throw error;
          });
      }
      await Promise.all([resumed, this.loading]);
    } catch (error) {
      if (this.disposed) return;
      this.stopAll();
      this.report(error);
    }
  }

  preview() {
    if (!this.enabled) return;
    void this.resume().then(() => {
      if (!this.enabled) return;
      const { pos, forward } = this.pose;
      this.playImpact({
        kind: "ball",
        ballId: 0,
        x: pos.x + forward.x,
        y: pos.y,
        z: pos.z + forward.z,
        speed: 1.5,
      });
    });
  }

  updateListener(pos: Point, forward: Point, up: Point = { x: 0, y: 1, z: 0 }) {
    if (
      ![
        ...Object.values(pos),
        ...Object.values(forward),
        ...Object.values(up),
      ].every(Number.isFinite)
    )
      return;
    this.pose = { pos: { ...pos }, forward: { ...forward }, up: { ...up } };
    for (const voice of this.voices) this.updateDistance(voice);
    const listener = this.audio?.listener;
    if (!listener) return;
    if (listener.positionX) {
      const time = this.audio!.currentTime;
      for (const [parameter, value] of [
        [listener.positionX, pos.x],
        [listener.positionY, pos.y],
        [listener.positionZ, pos.z],
        [listener.forwardX, forward.x],
        [listener.forwardY, forward.y],
        [listener.forwardZ, forward.z],
        [listener.upX, up.x],
        [listener.upY, up.y],
        [listener.upZ, up.z],
      ] as const)
        parameter.setTargetAtTime(value, time, 0.015);
    } else {
      listener.setPosition(pos.x, pos.y, pos.z);
      listener.setOrientation(
        forward.x,
        forward.y,
        forward.z,
        up.x,
        up.y,
        up.z,
      );
    }
  }

  setPrediction(context: PredictionContext | null) {
    this.prediction = context;
    // Ending prediction retains heard occurrences for delayed server confirmation.
  }

  predicted(tableId: string, rack: number, turn: number, sound: PoolSound) {
    const context = { tableId, rack, turn };
    if (
      this.prediction &&
      (this.prediction.tableId !== tableId ||
        this.prediction.rack !== rack ||
        this.prediction.turn !== turn)
    )
      return;
    const now = performance.now();
    if (consumeHeard(this.events.heard, context, sound, now, "server")) return;
    const spot = TABLES.find((table) => table.id === tableId);
    if (
      !spot ||
      !this.playImpact(sound, {
        ...sound,
        x: sound.x + spot.x,
        z: sound.z + spot.z,
      })
    )
      return;
    this.remember(context, sound, now, "predicted");
  }

  private remember(
    context: PredictionContext,
    sound: PoolSound,
    now: number,
    source: HeardSound["source"],
  ) {
    this.events.heard.push({
      ...context,
      sound: { ...sound },
      heardAt: now,
      source,
    });
    if (this.events.heard.length > 96) this.events.heard.shift();
  }

  observe(snapshot: Snapshot, _focusTable: string | null) {
    const now = performance.now();
    this.lastObserve = now;
    this.events.begin(snapshot.time, now);
    this.events.retain(new Set(snapshot.tables.map((table) => table.id)));
    for (const table of snapshot.tables) {
      const sounds = this.events.events(
        table.id,
        table.rack,
        table.sounds ?? [],
        snapshot.time,
      );
      const spot = TABLES.find(
        (candidateSpot) => candidateSpot.id === table.id,
      );
      if (!spot) continue;
      for (const sound of sounds) {
        if (
          consumeHeard(
            this.events.heard,
            { tableId: table.id, rack: table.rack, turn: sound.turn },
            sound,
            now,
          )
        )
          continue;
        if (
          this.playImpact(sound, {
            ...sound,
            x: sound.x + spot.x,
            z: sound.z + spot.z,
          })
        )
          this.remember(
            { tableId: table.id, rack: table.rack, turn: sound.turn },
            sound,
            now,
            "server",
          );
      }
    }
    this.updateRolling(snapshot);
  }

  private updateRolling(snapshot: Snapshot) {
    const candidates = snapshot.tables
      .flatMap((table) => {
        const spot = TABLES.find(
          (candidateSpot) => candidateSpot.id === table.id,
        );
        if (!spot) return [];
        return table.balls.flatMap((ball) => {
          const mix = rollingMix(ball);
          const point = { x: ball.x + spot.x, y: ball.y, z: ball.z + spot.z };
          if (!mix.gain || ![point.x, point.y, point.z].every(Number.isFinite))
            return [];
          const distance = Math.hypot(
            point.x - this.pose.pos.x,
            point.y - this.pose.pos.y,
            point.z - this.pose.pos.z,
          );
          return [
            {
              key: `${table.id}:${table.rack}:${ball.id}`,
              point,
              mix,
              priority: mix.gain * spatialMix(distance).dry,
            },
          ];
        });
      })
      .toSorted((a, b) => b.priority - a.priority)
      .slice(0, MAX_ROLLING_VOICES);
    const selected = new Set(candidates.map(({ key }) => key));
    for (const [key, voice] of this.loops) {
      if (selected.has(key)) continue;
      this.release(voice);
      this.loops.delete(key);
    }
    if (!this.ready() || !this.rolling) return;
    for (const { key, point, mix } of candidates) {
      let voice = this.loops.get(key);
      const buffer = mix.sample === "felt" ? this.feltRolling : this.rolling;
      if (!buffer) continue;
      if (voice && voice.source.buffer !== buffer) {
        this.release(voice);
        this.loops.delete(key);
        voice = undefined;
      }
      if (!voice && this.voices.size < MAX_VOICES) {
        voice = this.createVoice(buffer, point, mix, true);
        this.loops.set(key, voice);
      }
      if (!voice) continue;
      const time = this.audio!.currentTime;
      voice.point = point;
      voice.gain.gain.setTargetAtTime(mix.gain, time, 0.04);
      voice.source.playbackRate.setTargetAtTime(mix.rate, time, 0.1);
      voice.filter.frequency.setTargetAtTime(mix.cutoff, time, 0.08);
      voice.pan.positionX.setTargetAtTime(point.x, time, 0.015);
      voice.pan.positionY.setTargetAtTime(point.y, time, 0.015);
      voice.pan.positionZ.setTargetAtTime(point.z, time, 0.015);
      this.updateDistance(voice);
    }
  }

  private ready() {
    return (
      this.enabled && this.audio?.state === "running" && this.impact !== null
    );
  }

  private updateDistance(voice: Voice) {
    const mix = spatialMix(
      Math.hypot(
        voice.point.x - this.pose.pos.x,
        voice.point.y - this.pose.pos.y,
        voice.point.z - this.pose.pos.z,
      ),
    );
    const time = this.audio!.currentTime;
    voice.dry.gain.setTargetAtTime(mix.dry, time, 0.015);
    voice.spatial.gain.setTargetAtTime(mix.spatial, time, 0.015);
  }

  private createVoice(
    buffer: AudioBuffer,
    point: Point,
    mix: { gain: number; rate: number; cutoff: number },
    rolling = false,
  ) {
    const audio = this.audio!;
    const source = audio.createBufferSource(),
      gain = audio.createGain(),
      filter = audio.createBiquadFilter(),
      pan = audio.createPanner(),
      dry = audio.createGain(),
      spatial = audio.createGain();
    source.buffer = buffer;
    source.loop = rolling;
    source.playbackRate.value = mix.rate;
    gain.gain.value = rolling ? 0 : mix.gain;
    filter.type = "lowpass";
    filter.frequency.value = mix.cutoff;
    filter.Q.value = 0.5;
    pan.panningModel = "HRTF";
    pan.distanceModel = "inverse";
    pan.refDistance = 1;
    pan.maxDistance = 30;
    // Distance is applied equally to the centered and HRTF branches below.
    pan.rolloffFactor = 0;
    pan.positionX.value = point.x;
    pan.positionY.value = point.y;
    pan.positionZ.value = point.z;
    const distance = spatialMix(
      Math.hypot(
        point.x - this.pose.pos.x,
        point.y - this.pose.pos.y,
        point.z - this.pose.pos.z,
      ),
    );
    dry.gain.value = distance.dry;
    spatial.gain.value = distance.spatial;
    source.connect(filter).connect(gain);
    gain.connect(dry).connect(this.master!);
    gain.connect(pan).connect(spatial).connect(this.master!);
    const offset = rolling ? Math.random() * buffer.duration : 0;
    const voice = {
      source,
      gain,
      filter,
      pan,
      dry,
      spatial,
      point: { ...point },
      level: mix.gain,
      rolling,
    };
    this.voices.add(voice);
    source.addEventListener("ended", () => this.disconnect(voice), {
      once: true,
    });
    source.start(0, offset);
    return voice;
  }

  private playImpact(sound: PoolSound, point: Point = sound) {
    if (!this.ready() || ![point.x, point.y, point.z].every(Number.isFinite))
      return false;
    const base = impactMix(sound);
    const pitchVariation = sound.kind === "cue" ? 0.04 : 0.025;
    const mix = {
      ...base,
      rate:
        base.rate * (1 - pitchVariation + Math.random() * pitchVariation * 2),
      gain: base.gain * (0.95 + Math.random() * 0.1),
    };
    if (!mix.gain) return false;
    const impacts = [...this.voices].filter((voice) => !voice.rolling);
    if (impacts.length >= MAX_IMPACT_VOICES || this.voices.size >= MAX_VOICES) {
      const weakest = impacts.toSorted((a, b) => a.level - b.level)[0];
      if (!weakest || weakest.level >= mix.gain) return false;
      weakest.source.stop();
      this.disconnect(weakest);
    }
    const buffer = {
      impact: this.lastImpactDry ? this.impact : this.impactDry,
      cushion: this.felt,
      cue: this.lastCueCloth ? this.cue : this.cueCloth,
      pocket: this.pocket,
      return: this.cabinet,
      felt: this.felt,
      floor: this.pocket,
    }[mix.sample];
    if (!buffer) return false;
    this.createVoice(buffer, point, mix);
    if (mix.sample === "impact") this.lastImpactDry = !this.lastImpactDry;
    if (mix.sample === "cue") this.lastCueCloth = !this.lastCueCloth;
    return true;
  }

  private disconnect(voice: Voice) {
    this.voices.delete(voice);
    voice.source.disconnect();
    voice.filter.disconnect();
    voice.gain.disconnect();
    voice.pan.disconnect();
    voice.dry.disconnect();
    voice.spatial.disconnect();
  }

  private release(voice: Voice) {
    const time = this.audio!.currentTime;
    voice.gain.gain.cancelScheduledValues(time);
    voice.gain.gain.setTargetAtTime(0, time, 0.04);
    voice.source.stop(time + 0.2);
  }

  private stopLoops() {
    for (const voice of this.loops.values()) this.release(voice);
    this.loops.clear();
  }

  private stopAll() {
    for (const voice of this.voices) {
      voice.source.stop();
      this.disconnect(voice);
    }
    this.loops.clear();
    this.events.heard.length = 0;
  }

  reset() {
    this.stopAll();
    this.events.reset();
    this.prediction = null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    this.enabled = false;
    this.reset();
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    void this.audio?.close().catch((error) => this.report(error));
    this.audio = null;
    this.master = null;
    this.loading = null;
    this.impactDry = this.cueCloth = null;
    this.impact =
      this.pocket =
      this.cue =
      this.cabinet =
      this.felt =
      this.rolling =
      this.feltRolling =
        null;
  }
}
