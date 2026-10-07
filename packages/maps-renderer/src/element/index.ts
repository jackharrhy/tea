import { createWorldview } from "../viewer/viewer.js";
import type {
  BinarySource,
  WorldSource,
  WorldviewEventMap,
  WorldviewViewer,
} from "../viewer/types.js";

const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host {
      color-scheme: light dark;
      display: block;
      position: relative;
      min-block-size: 18rem;
      overflow: hidden;
      background: #07100c;
      contain: content;
    }

    canvas {
      display: block;
      inline-size: 100%;
      block-size: 100%;
      min-block-size: inherit;
      outline: none;
    }

    canvas:focus-visible {
      box-shadow: inset 0 0 0 2px #8cffb0;
    }

    [part='status'] {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 1.5rem;
      color: #d9f4df;
      background: color-mix(in srgb, #07100c 88%, transparent);
      font: 600 0.75rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
      letter-spacing: 0.08em;
      text-align: center;
      text-transform: uppercase;
      pointer-events: none;
    }

    [part='status'][hidden] {
      display: none;
    }

    @media (prefers-color-scheme: light) {
      :host { background: #d9ddcf; }
      [part='status'] { color: #163524; background: color-mix(in srgb, #eef0e6 88%, transparent); }
    }
  </style>
  <canvas part="canvas" aria-label="Interactive Quake or GoldSrc map"></canvas>
  <div part="status" role="status" aria-live="polite">Waiting for a BSP source</div>
`;

function booleanAttribute(
  element: Element,
  name: string,
  fallback: boolean,
): boolean {
  if (!element.hasAttribute(name)) return fallback;
  return element.getAttribute(name)?.toLowerCase() !== "false";
}

export class WorldViewElement extends HTMLElement {
  public static readonly observedAttributes = [
    "src",
    "game-base-url",
    "palette-src",
    "wad-base-url",
    "skybox-base-url",
    "sprite-base-url",
    "sound-base-url",
    "controls",
    "autostart",
    "audio",
    "audio-volume",
    "music-volume",
    "max-dpr",
    "walkability-src",
    "walkability-visible",
  ];

  private readonly canvasElement: HTMLCanvasElement;
  private readonly statusElement: HTMLDivElement;
  private activeViewer: WorldviewViewer | null = null;
  private controller: AbortController | null = null;
  private sidecarController: AbortController | null = null;
  private assignedSource: WorldSource | undefined;
  private assignedWalkabilitySource: BinarySource | undefined;
  private generation = 0;
  private walkabilityGeneration = 0;

  public constructor() {
    super();
    const shadow = this.attachShadow({ mode: "open" });
    shadow.append(template.content.cloneNode(true));
    this.canvasElement = shadow.querySelector("canvas")!;
    this.statusElement = shadow.querySelector('[part="status"]')!;
  }

  public get viewer(): WorldviewViewer | null {
    return this.activeViewer;
  }

  public override addEventListener<K extends keyof WorldviewEventMap>(
    type: K,
    listener: (this: WorldViewElement, event: WorldviewEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  public override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  public override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(type, listener, options);
  }

  public override removeEventListener<K extends keyof WorldviewEventMap>(
    type: K,
    listener: (this: WorldViewElement, event: WorldviewEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  public override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
  public override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    super.removeEventListener(type, listener, options);
  }

  /** The canonical atomic world configuration. URL attributes are used when this is null. */
  public get source(): WorldSource | null {
    return this.assignedSource ?? this.declarativeSource();
  }

  public set source(value: WorldSource | null) {
    this.assignedSource = value ?? undefined;
    if (this.isConnected) void this.initialize();
  }

  /** Optional persisted walkability loaded after the world becomes interactive. */
  public get walkabilitySource(): BinarySource | null {
    return (
      this.assignedWalkabilitySource ?? this.getAttribute("walkability-src")
    );
  }

  public set walkabilitySource(value: BinarySource | null) {
    this.assignedWalkabilitySource = value ?? undefined;
    if (this.isConnected) this.refreshWalkability();
  }

  public get walkabilityVisible(): boolean {
    return (
      this.activeViewer?.walkabilityVisible ??
      booleanAttribute(this, "walkability-visible", false)
    );
  }

  public set walkabilityVisible(value: boolean) {
    if (this.hasAttribute("walkability-visible") === value) {
      this.activeViewer?.setWalkabilityVisible(value);
      return;
    }
    this.toggleAttribute("walkability-visible", value);
  }

  public connectedCallback(): void {
    void this.initialize();
  }

  public disconnectedCallback(): void {
    this.generation += 1;
    this.walkabilityGeneration += 1;
    this.sidecarController?.abort(
      new DOMException("Element disconnected", "AbortError"),
    );
    this.sidecarController = null;
    this.controller?.abort(
      new DOMException("Element disconnected", "AbortError"),
    );
    this.controller = null;
    this.activeViewer?.dispose();
    this.activeViewer = null;
  }

  public attributeChangedCallback(
    name: string,
    previous: string | null,
    value: string | null,
  ): void {
    if (!this.isConnected || previous === value) return;
    if (name === "walkability-visible") {
      this.activeViewer?.setWalkabilityVisible(
        booleanAttribute(this, "walkability-visible", false),
      );
      return;
    }
    if (name === "walkability-src") {
      if (this.assignedWalkabilitySource === undefined)
        this.refreshWalkability();
      return;
    }
    if (
      this.activeViewer &&
      (name === "audio-volume" || name === "music-volume")
    ) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        if (name === "audio-volume") this.activeViewer.setAudioVolume(parsed);
        else this.activeViewer.setMusicVolume(parsed);
      }
      return;
    }
    if (this.assignedSource && WorldViewElement.sourceAttributes.has(name))
      return;
    void this.initialize();
  }

  private static readonly sourceAttributes = new Set([
    "src",
    "game-base-url",
    "palette-src",
    "wad-base-url",
    "skybox-base-url",
    "sprite-base-url",
    "sound-base-url",
  ]);

  private declarativeSource(): WorldSource | null {
    const bsp = this.getAttribute("src");
    if (!bsp) return null;
    const gameBaseUrl = this.getAttribute("game-base-url");
    const palette = this.getAttribute("palette-src");
    const wadBaseUrl = this.getAttribute("wad-base-url");
    const skyboxBaseUrl = this.getAttribute("skybox-base-url");
    const spriteBaseUrl = this.getAttribute("sprite-base-url");
    const soundBaseUrl = this.getAttribute("sound-base-url");
    return {
      bsp,
      ...(gameBaseUrl ? { gameBaseUrl } : {}),
      ...(palette ? { palette } : {}),
      ...(wadBaseUrl ? { wadBaseUrl } : {}),
      ...(skyboxBaseUrl ? { skyboxBaseUrl } : {}),
      ...(spriteBaseUrl ? { spriteBaseUrl } : {}),
      ...(soundBaseUrl ? { soundBaseUrl } : {}),
    };
  }

  private async initialize(): Promise<void> {
    const generation = ++this.generation;
    this.walkabilityGeneration += 1;
    this.sidecarController?.abort(
      new DOMException("Element world source changed", "AbortError"),
    );
    this.sidecarController = null;
    this.controller?.abort(
      new DOMException("Element attributes changed", "AbortError"),
    );
    this.activeViewer?.dispose();
    this.activeViewer = null;
    const controller = new AbortController();
    this.controller = controller;
    const source = this.source;
    this.show(source ? "Initializing WebGPU" : "Waiting for a BSP source");

    try {
      const maxDprValue = Number(this.getAttribute("max-dpr") ?? 2);
      const audioVolumeValue = Number(this.getAttribute("audio-volume") ?? 0.8);
      const musicVolumeValue = Number(this.getAttribute("music-volume") ?? 1);
      const viewer = await createWorldview({
        canvas: this.canvasElement,
        controls:
          this.getAttribute("controls") === "none"
            ? "none"
            : this.getAttribute("controls") === "fly"
              ? "fly"
              : "walk",
        autoStart: booleanAttribute(this, "autostart", true),
        maxDevicePixelRatio: Number.isFinite(maxDprValue) ? maxDprValue : 2,
        audio: booleanAttribute(this, "audio", true),
        audioVolume: Number.isFinite(audioVolumeValue) ? audioVolumeValue : 0.8,
        musicVolume: Number.isFinite(musicVolumeValue) ? musicVolumeValue : 1,
        signal: controller.signal,
      });
      if (generation !== this.generation || !this.isConnected) {
        viewer.dispose();
        return;
      }
      this.activeViewer = viewer;
      this.mirrorEvents(viewer);
      if (booleanAttribute(this, "walkability-visible", false)) {
        viewer.setWalkabilityVisible(true);
      }
      if (source) {
        await viewer.load(source, { signal: controller.signal });
        if (generation !== this.generation || this.activeViewer !== viewer)
          return;
        this.refreshWalkability();
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      this.show(message);
      if (!this.activeViewer) {
        this.redispatch("error", {
          error: error instanceof Error ? error : new Error(message),
        });
      }
    }
  }

  private mirrorEvents(viewer: WorldviewViewer): void {
    viewer.addEventListener("progress", (event) => {
      if (event.detail.phase !== "walkability" || !viewer.world) {
        this.show(`${event.detail.phase}: ${event.detail.label ?? "loading"}`);
      }
      this.redispatch("progress", event.detail);
    });
    viewer.addEventListener("ready", (event) => {
      this.statusElement.hidden = true;
      this.redispatch("ready", event.detail);
    });
    viewer.addEventListener("warning", (event) =>
      this.redispatch("warning", event.detail),
    );
    viewer.addEventListener("audiochange", (event) =>
      this.redispatch("audiochange", event.detail),
    );
    viewer.addEventListener("movementchange", (event) =>
      this.redispatch("movementchange", event.detail),
    );
    viewer.addEventListener("walkabilitychange", (event) =>
      this.redispatch("walkabilitychange", event.detail),
    );
    viewer.addEventListener("error", (event) => {
      this.show(event.detail.error.message);
      this.redispatch("error", event.detail);
    });
  }

  private refreshWalkability(): void {
    const generation = ++this.walkabilityGeneration;
    this.sidecarController?.abort(
      new DOMException("Element walkability source changed", "AbortError"),
    );
    this.sidecarController = null;
    const viewer = this.activeViewer;
    if (!viewer?.world) return;
    const source = this.walkabilitySource;
    if (viewer.walkability) viewer.setWalkability(null);
    if (!source) {
      return;
    }
    const controller = new AbortController();
    this.sidecarController = controller;
    void viewer
      .loadWalkability(source, { signal: controller.signal })
      .catch((error: unknown) => {
        if (
          controller.signal.aborted ||
          generation !== this.walkabilityGeneration ||
          viewer !== this.activeViewer
        ) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        this.redispatch("warning", {
          code: "asset-warning",
          message: `walkability sidecar could not be loaded: ${message}`,
        });
      })
      .finally(() => {
        if (this.sidecarController === controller)
          this.sidecarController = null;
      });
  }

  private redispatch<K extends keyof WorldviewEventMap>(
    type: K,
    detail: WorldviewEventMap[K]["detail"],
  ): void {
    this.dispatchEvent(
      new CustomEvent(type, { detail, bubbles: true, composed: true }),
    );
  }

  private show(message: string): void {
    this.statusElement.textContent = message;
    this.statusElement.hidden = false;
  }
}

export function defineWorldViewElement(tagName = "world-view"): void {
  if (!customElements.get(tagName))
    customElements.define(tagName, WorldViewElement);
}
