import type { AmbientAudioEntity, WorldBundle } from "@tea/gurgur-game";
import type { CompiledBrush, Vec3 } from "@tea/gurgur-engine";

type SelectedAudio = {
  entityIndex: number;
  entity: AmbientAudioEntity;
};

type PlayingAudio = SelectedAudio & {
  source: AudioBufferSourceNode;
  gain: GainNode;
};

export type WorldAudioState = {
  state: "idle" | "locked" | "loading" | "playing" | "error";
  asset?: string;
};

export function selectAmbientAudio(
  bundle: Pick<WorldBundle, "entities" | "brushes">,
  listener: Vec3,
): SelectedAudio | null {
  const claimedEntityIndices = new Set<number>();
  for (const entity of bundle.entities) {
    if (
      entity.kind !== "trigger" ||
      entity.outputs.enter.input !== "play" ||
      entity.outputs.exit?.input !== "stop"
    )
      continue;
    if (
      entity.body.brushIndices.some((brushIndex) => {
        const brush = bundle.brushes[brushIndex];
        return brush ? pointInsideConvexBrush(listener, brush) : false;
      })
    ) {
      for (const entityIndex of entity.outputs.enter.targetEntityIndices)
        claimedEntityIndices.add(entityIndex);
    }
  }
  if (claimedEntityIndices.size === 0) return null;
  const candidates: SelectedAudio[] = [];
  bundle.entities.forEach((entity, entityIndex) => {
    if (
      entity.kind === "ambient-audio" &&
      claimedEntityIndices.has(entityIndex)
    )
      candidates.push({ entityIndex, entity });
  });
  candidates.sort(
    (left, right) =>
      right.entity.priority - left.entity.priority ||
      left.entityIndex - right.entityIndex,
  );
  return candidates[0] ?? null;
}

function pointInsideConvexBrush(
  point: Vec3,
  brush: Pick<
    CompiledBrush,
    "center" | "worldVertices" | "triangles" | "triangleNormals"
  >,
  epsilon = 1e-5,
): boolean {
  for (let index = 0; index < brush.triangles.length; index += 1) {
    const triangle = brush.triangles[index]!;
    const anchor = brush.worldVertices[triangle[0]!]!;
    const normal = brush.triangleNormals[index]!;
    const centerSide = dotSubtract(brush.center, anchor, normal);
    const pointSide = dotSubtract(point, anchor, normal);
    if (centerSide >= 0 ? pointSide < -epsilon : pointSide > epsilon)
      return false;
  }
  return true;
}

export class WorldAudio {
  readonly #assetUrls: Readonly<Record<string, string>>;
  readonly #onState: (state: WorldAudioState) => void;
  readonly #encoded = new Map<string, Promise<ArrayBuffer>>();
  readonly #decoded = new Map<string, Promise<AudioBuffer>>();
  #bundle: WorldBundle | null = null;
  #context: AudioContext | null = null;
  #desired: SelectedAudio | null = null;
  #playing: PlayingAudio | null = null;
  #generation = 0;
  #disposed = false;

  constructor(
    assetUrls: Readonly<Record<string, string>>,
    onState: (state: WorldAudioState) => void = () => {},
  ) {
    this.#assetUrls = assetUrls;
    this.#onState = onState;
    this.#onState({ state: "idle" });
  }

  setWorld(bundle: WorldBundle): void {
    this.#generation += 1;
    this.#stopCurrent(0);
    this.#bundle = bundle;
    this.#desired = null;
    for (const entity of bundle.entities)
      if (entity.kind === "ambient-audio")
        void this.#encodedAsset(entity.asset).catch(() => {});
    this.#onState({ state: "idle" });
  }

  update(listener: Vec3): void {
    if (this.#disposed || !this.#bundle) return;
    const selected = selectAmbientAudio(this.#bundle, listener);
    if (selected?.entityIndex === this.#desired?.entityIndex) return;
    this.#desired = selected;
    void this.#sync();
  }

  async unlock(): Promise<void> {
    if (this.#disposed) return;
    this.#context ??= new AudioContext();
    await this.#context.resume();
    await this.#sync();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#generation += 1;
    this.#stopCurrent(0);
    void this.#context?.close();
    this.#context = null;
    this.#bundle = null;
    this.#desired = null;
    this.#decoded.clear();
  }

  async #sync(): Promise<void> {
    const desired = this.#desired;
    const current = this.#playing;
    if (current?.entityIndex === desired?.entityIndex) return;
    const generation = ++this.#generation;
    if (current) this.#stopCurrent(current.entity.fadeOutSeconds);
    if (!desired) {
      this.#onState({ state: "idle" });
      return;
    }
    const context = this.#context;
    if (!context || context.state !== "running") {
      this.#onState({ state: "locked", asset: desired.entity.asset });
      return;
    }
    this.#onState({ state: "loading", asset: desired.entity.asset });
    try {
      const buffer = await this.#decodedAsset(desired.entity.asset, context);
      if (
        this.#disposed ||
        generation !== this.#generation ||
        this.#desired?.entityIndex !== desired.entityIndex
      )
        return;
      const source = context.createBufferSource();
      const gain = context.createGain();
      source.buffer = buffer;
      source.loop = desired.entity.loop;
      source.connect(gain);
      gain.connect(context.destination);
      const now = context.currentTime;
      const fade = desired.entity.fadeInSeconds;
      gain.gain.setValueAtTime(fade > 0 ? 0 : desired.entity.volume, now);
      if (fade > 0)
        gain.gain.linearRampToValueAtTime(desired.entity.volume, now + fade);
      const playing = { ...desired, source, gain };
      this.#playing = playing;
      source.addEventListener("ended", () => {
        if (this.#playing?.source !== source) return;
        this.#playing = null;
        this.#onState({ state: "idle" });
      });
      source.start();
      this.#onState({ state: "playing", asset: desired.entity.asset });
    } catch {
      if (generation === this.#generation)
        this.#onState({ state: "error", asset: desired.entity.asset });
    }
  }

  #stopCurrent(fadeSeconds: number): void {
    const playing = this.#playing;
    if (!playing) return;
    this.#playing = null;
    const context = this.#context;
    if (!context || context.state === "closed") {
      playing.source.disconnect();
      playing.gain.disconnect();
      return;
    }
    const now = context.currentTime;
    const fade = Math.max(0, fadeSeconds);
    playing.gain.gain.cancelScheduledValues(now);
    playing.gain.gain.setValueAtTime(playing.gain.gain.value, now);
    playing.gain.gain.linearRampToValueAtTime(0, now + fade);
    playing.source.stop(now + fade + 0.01);
  }

  #encodedAsset(asset: string): Promise<ArrayBuffer> {
    const existing = this.#encoded.get(asset);
    if (existing) return existing;
    const url = this.#assetUrls[asset];
    const encoded = (async () => {
      if (!url) throw new Error(`audio asset ${asset} is missing`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`audio asset ${asset} failed to load`);
      return response.arrayBuffer();
    })();
    this.#encoded.set(asset, encoded);
    return encoded;
  }

  #decodedAsset(asset: string, context: AudioContext): Promise<AudioBuffer> {
    const existing = this.#decoded.get(asset);
    if (existing) return existing;
    const decoded = this.#encodedAsset(asset).then((bytes) =>
      context.decodeAudioData(bytes.slice(0)),
    );
    this.#decoded.set(asset, decoded);
    return decoded;
  }
}

function dotSubtract(point: Vec3, anchor: Vec3, normal: Vec3): number {
  return (
    (point.x - anchor.x) * normal.x +
    (point.y - anchor.y) * normal.y +
    (point.z - anchor.z) * normal.z
  );
}
