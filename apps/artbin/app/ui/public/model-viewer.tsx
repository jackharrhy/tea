import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MD2Loader } from "three/addons/loaders/MD2Loader.js";
import { MTLLoader } from "three/addons/loaders/MTLLoader.js";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import {
  clientEntry,
  css,
  on,
  ref,
  type Handle,
  type SerializableProps,
} from "remix/component";

import { ASELoader } from "./loaders/ASELoader.ts";
import { MD5Loader } from "./loaders/MD5Loader.ts";
import {
  buttonStyle,
  dangerTextStyle,
  inputStyle,
  monoTextStyle,
  smallButtonStyle,
  theme,
} from "../styles.ts";

const rootStyle = css({ width: "100%" });
const stageStyle = css({ position: "relative" });
const viewportStyle = css({
  background: theme.color.hover,
  overflow: "hidden",
  width: "100%",
});
const canvasStyle = css({ display: "block", height: "100%", width: "100%" });
const statusOverlayStyle = css({
  alignItems: "center",
  background: "rgba(245, 245, 245, 0.9)",
  display: "flex",
  inset: 0,
  justifyContent: "center",
  position: "absolute",
});
const statusHeadingStyle = css({
  color: theme.color.muted,
  fontSize: "1.5rem",
});
const errorBlockStyle = css({ textAlign: "center" });
const errorHeadingStyle = css({ fontSize: "1.5rem", marginBottom: "0.5rem" });
const errorDetailStyle = css({ fontSize: "0.875rem" });
const animationBarStyle = css({
  alignItems: "center",
  background: "rgba(255, 255, 255, 0.9)",
  bottom: "0.625rem",
  display: "flex",
  fontSize: "0.8125rem",
  gap: "0.5rem",
  left: "0.625rem",
  padding: "0.5rem",
  position: "absolute",
  right: "0.625rem",
});
const animationButtonStyle = css({ borderColor: theme.color.borderLight });
const selectStyle = css({
  flex: "1",
  fontSize: "0.8125rem",
  padding: "0.25rem",
});
const animationCountStyle = css({
  color: theme.color.muted,
  fontSize: "0.75rem",
});
const instructionsStyle = css({
  background: "rgba(255, 255, 255, 0.8)",
  color: theme.color.faint,
  fontSize: "0.6875rem",
  padding: "0.25rem 0.5rem",
  position: "absolute",
  right: "0.625rem",
  top: "0.625rem",
});
const textureBarStyle = css({
  alignItems: "center",
  background: theme.color.background,
  borderTop: `1px solid ${theme.color.subtle}`,
  display: "flex",
  fontSize: "0.8125rem",
  gap: "0.5rem",
  padding: "0.5rem",
});
const textureLabelStyle = css({ color: theme.color.muted });

export type ModelFormat = "md2" | "md5mesh" | "ase" | "obj" | "gltf" | "glb";

interface ModelViewerProps extends SerializableProps {
  modelUrl: string;
  textureUrl?: string;
  textures?: Array<{ name: string; url: string }>;
  mtlUrl?: string;
  animUrls?: string[];
  format: ModelFormat;
  height?: number;
}

interface AnimationInfo {
  names: string[];
  currentIndex: number;
  isPlaying: boolean;
}

export const ModelViewer = clientEntry(
  `${import.meta.url}#ModelViewer`,
  function ModelViewer(handle: Handle<ModelViewerProps>) {
    let scene: ModelScene | null = null;
    let loading = true;
    let error: string | null = null;
    let animation: AnimationInfo | null = null;
    let selectedTexture = handle.props.textureUrl;

    async function load() {
      if (!scene) return;
      loading = true;
      error = null;
      animation = null;
      await handle.update();
      await scene.loadModel(
        handle.props.modelUrl,
        handle.props.format,
        selectedTexture,
        handle.props.mtlUrl,
        handle.props.animUrls,
      );
    }

    return () => {
      const height = handle.props.height ?? 400;
      return (
        <div mix={rootStyle}>
          <div mix={stageStyle}>
            <div mix={viewportStyle} style={{ height: `${height}px` }}>
              <canvas
                mix={[
                  canvasStyle,
                  ref((element, signal) => {
                    scene = new ModelScene(
                      element as HTMLCanvasElement,
                      height,
                    );
                    scene.onLoadStart = () => {
                      loading = true;
                      error = null;
                      handle.update();
                    };
                    scene.onLoadComplete = () => {
                      loading = false;
                      handle.update();
                    };
                    scene.onLoadError = (message) => {
                      loading = false;
                      error = message;
                      handle.update();
                    };
                    scene.onAnimationChange = (info) => {
                      animation = info;
                      handle.update();
                    };
                    signal.addEventListener("abort", () => {
                      scene?.dispose();
                      scene = null;
                    });
                    load();
                  }),
                ]}
              />
            </div>
            {loading ? (
              <div mix={statusOverlayStyle}>
                <div mix={statusHeadingStyle}>Loading model...</div>
              </div>
            ) : null}
            {error ? (
              <div mix={statusOverlayStyle}>
                <div mix={[errorBlockStyle, dangerTextStyle]}>
                  <div mix={errorHeadingStyle}>Failed to load model</div>
                  <div mix={errorDetailStyle}>{error}</div>
                </div>
              </div>
            ) : null}
            {!loading && !error && animation?.names.length ? (
              <div mix={animationBarStyle}>
                <button
                  type="button"
                  mix={[
                    buttonStyle,
                    smallButtonStyle,
                    monoTextStyle,
                    animationButtonStyle,
                    on("click", () => scene?.togglePlayPause()),
                  ]}
                >
                  {animation.isPlaying ? "Pause" : "Play"}
                </button>
                <select
                  value={animation.currentIndex}
                  mix={[
                    inputStyle,
                    selectStyle,
                    on("change", (event) => {
                      scene?.playAnimation(
                        Number.parseInt(
                          (event.currentTarget as HTMLSelectElement).value,
                          10,
                        ),
                      );
                    }),
                  ]}
                >
                  {animation.names.map((name, index) => (
                    <option key={`${name}-${index}`} value={index}>
                      {name || `Animation ${index + 1}`}
                    </option>
                  ))}
                </select>
                <span mix={animationCountStyle}>
                  {animation.names.length} animation
                  {animation.names.length === 1 ? "" : "s"}
                </span>
              </div>
            ) : null}
            {!loading && !error ? (
              <div mix={instructionsStyle}>Drag to rotate. Scroll to zoom.</div>
            ) : null}
          </div>
          {(handle.props.textures?.length ?? 0) > 1 ? (
            <div mix={textureBarStyle}>
              <label mix={textureLabelStyle}>Texture:</label>
              <select
                value={selectedTexture ?? ""}
                mix={[
                  inputStyle,
                  selectStyle,
                  on("change", async (event) => {
                    selectedTexture =
                      (event.currentTarget as HTMLSelectElement).value ||
                      undefined;
                    await handle.update();
                    await load();
                  }),
                ]}
              >
                <option value="">None</option>
                {handle.props.textures?.map((texture) => (
                  <option key={texture.url} value={texture.url}>
                    {texture.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      );
    };
  },
);

class ModelScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private timer = new THREE.Timer();
  private animationFrameId: number | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private currentAction: THREE.AnimationAction | null = null;
  private resizeObserver: ResizeObserver;
  private clips: THREE.AnimationClip[] = [];
  private currentClipIndex = 0;
  private isPlaying = true;

  onAnimationChange?: (info: AnimationInfo) => void;
  onLoadStart?: () => void;
  onLoadComplete?: () => void;
  onLoadError?: (error: string) => void;

  constructor(
    private canvas: HTMLCanvasElement,
    private height: number,
  ) {
    this.scene.background = new THREE.Color(0xf5f5f5);
    this.timer.connect(document);
    const container = canvas.parentElement ?? canvas;
    const width = container.clientWidth || 800;
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1_000);
    this.camera.position.set(0, 50, 100);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.screenSpacePanning = false;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 500;
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
    keyLight.position.set(50, 100, 50);
    this.scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-50, 50, -50);
    this.scene.add(fillLight);
    this.scene.add(new THREE.GridHelper(200, 20, 0xcccccc, 0xe0e0e0));
    this.resizeObserver = new ResizeObserver(([entry]) => {
      const nextWidth = entry?.contentRect.width ?? 0;
      if (!nextWidth) return;
      this.camera.aspect = nextWidth / this.height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(nextWidth, this.height);
    });
    this.resizeObserver.observe(container);
    this.animate();
  }

  private animate = (timestamp?: number) => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    this.timer.update(timestamp);
    this.mixer?.update(this.timer.getDelta());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  async loadModel(
    url: string,
    format: ModelFormat,
    textureUrl?: string,
    mtlUrl?: string,
    animUrls?: string[],
  ) {
    this.onLoadStart?.();
    this.clearModel();
    try {
      if (format === "md2") await this.loadMD2(url, textureUrl);
      else if (format === "md5mesh")
        await this.loadMD5(url, textureUrl, animUrls);
      else if (format === "ase") await this.loadASE(url, textureUrl);
      else if (format === "obj") await this.loadOBJ(url, textureUrl, mtlUrl);
      else await this.loadGLTF(url);
      this.onLoadComplete?.();
    } catch (caught) {
      console.error("Model load error", caught);
      this.onLoadError?.(
        caught instanceof Error ? caught.message : "Failed to load model",
      );
    }
  }

  private loadMD2(url: string, textureUrl?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      new MD2Loader().load(
        url,
        (geometry) => {
          const material = textureUrl
            ? new THREE.MeshLambertMaterial({ map: loadTexture(textureUrl) })
            : new THREE.MeshLambertMaterial({
                color: 0x888888,
                flatShading: true,
              });
          const mesh = new THREE.Mesh(geometry, material);
          this.scene.add(mesh);
          this.fitModelToView(mesh);
          const clips = (
            geometry as THREE.BufferGeometry & {
              animations?: THREE.AnimationClip[];
            }
          ).animations;
          if (clips?.length) this.setupAnimations(clips, mesh);
          resolve();
        },
        undefined,
        reject,
      );
    });
  }

  private async loadMD5(url: string, textureUrl?: string, animUrls?: string[]) {
    const loader = new MD5Loader();
    const { mesh, skeleton } = await loader.loadMesh(url, textureUrl);
    this.scene.add(mesh);
    this.fitModelToView(mesh);
    const clips: THREE.AnimationClip[] = [];
    for (const animationUrl of animUrls ?? []) {
      try {
        clips.push(await loader.loadAnim(animationUrl, skeleton));
      } catch (caught) {
        console.warn(`Failed to load animation ${animationUrl}`, caught);
      }
    }
    if (clips.length) this.setupAnimations(clips, mesh);
  }

  private async loadASE(url: string, textureUrl?: string) {
    const group = await new ASELoader().load(url, textureUrl);
    this.scene.add(group);
    this.fitModelToView(group);
  }

  private loadOBJ(
    url: string,
    textureUrl?: string,
    mtlUrl?: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const loader = new OBJLoader();
      const finish = (materials?: MTLLoader.MaterialCreator) => {
        if (materials) {
          materials.preload();
          loader.setMaterials(materials);
        }
        loader.load(
          url,
          (object) => {
            if (!mtlUrl) {
              const texture = textureUrl ? loadTexture(textureUrl) : null;
              object.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                  child.material = new THREE.MeshLambertMaterial(
                    texture
                      ? { map: texture }
                      : { color: 0x888888, flatShading: true },
                  );
                }
              });
            }
            this.scene.add(object);
            this.fitModelToView(object);
            resolve();
          },
          undefined,
          reject,
        );
      };
      if (!mtlUrl) return finish();
      const materialLoader = new MTLLoader();
      materialLoader.setPath(mtlUrl.slice(0, mtlUrl.lastIndexOf("/") + 1));
      materialLoader.load(
        mtlUrl.slice(mtlUrl.lastIndexOf("/") + 1),
        finish,
        undefined,
        () => finish(),
      );
    });
  }

  private loadGLTF(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      new GLTFLoader().load(
        url,
        (gltf) => {
          this.scene.add(gltf.scene);
          this.fitModelToView(gltf.scene);
          if (gltf.animations.length)
            this.setupAnimations(gltf.animations, gltf.scene);
          resolve();
        },
        undefined,
        reject,
      );
    });
  }

  private fitModelToView(object: THREE.Object3D) {
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    object.position.sub(center);
    const maxDimension = Math.max(size.x, size.y, size.z);
    if (maxDimension > 0) object.scale.multiplyScalar(50 / maxDimension);
    this.camera.position.set(0, 30, 80);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  private setupAnimations(
    clips: THREE.AnimationClip[],
    target: THREE.Object3D,
  ) {
    this.clips = clips;
    this.mixer = new THREE.AnimationMixer(target);
    this.currentAction = this.mixer.clipAction(clips[0]!);
    this.currentAction.play();
    this.currentClipIndex = 0;
    this.isPlaying = true;
    this.notifyAnimationChange();
  }

  private notifyAnimationChange() {
    this.onAnimationChange?.({
      names: this.clips.map((clip) => clip.name),
      currentIndex: this.currentClipIndex,
      isPlaying: this.isPlaying,
    });
  }

  playAnimation(index: number) {
    if (!this.mixer || index < 0 || index >= this.clips.length) return;
    this.currentAction?.stop();
    this.currentAction = this.mixer.clipAction(this.clips[index]!);
    this.currentAction.play();
    this.currentClipIndex = index;
    this.isPlaying = true;
    this.notifyAnimationChange();
  }

  togglePlayPause() {
    if (!this.currentAction) return;
    this.currentAction.paused = !this.currentAction.paused;
    this.isPlaying = !this.currentAction.paused;
    this.notifyAnimationChange();
  }

  private clearModel() {
    this.mixer?.stopAllAction();
    this.mixer = null;
    this.currentAction = null;
    this.clips = [];
    this.currentClipIndex = 0;
    const removable: THREE.Object3D[] = [];
    for (const child of this.scene.children) {
      if (child instanceof THREE.Mesh || child instanceof THREE.Group)
        removable.push(child);
    }
    for (const object of removable) {
      this.scene.remove(object);
      disposeObject(object);
    }
  }

  dispose() {
    if (this.animationFrameId !== null)
      cancelAnimationFrame(this.animationFrameId);
    this.timer.dispose();
    this.resizeObserver.disconnect();
    this.clearModel();
    this.controls.dispose();
    this.renderer.dispose();
  }
}

function loadTexture(url: string): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      material.dispose();
    }
  });
}
