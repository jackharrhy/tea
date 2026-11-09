import * as THREE from "three/webgpu";
const ballColors = [
  "#f6f0df",
  "#e8b72d",
  "#315ca8",
  "#c94336",
  "#8350a2",
  "#dc792b",
  "#34846c",
  "#8a2b32",
  "#131716",
  "#e8b72d",
  "#315ca8",
  "#c94336",
  "#8350a2",
  "#dc792b",
  "#34846c",
  "#8a2b32",
];
export function canvasTexture(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  draw(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
export function label(text: string, width: number, color = "#eee6cd") {
  const texture = canvasTexture(512, 128, (ctx) => {
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 50px Trebuchet MS, sans-serif";
    ctx.fillText(text, 256, 67, 480);
  });
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
    }),
  );
  sprite.scale.set(width, width / 4, 1);
  return sprite;
}
export function plaque(text: string, width: number) {
  const map = canvasTexture(768, 192, (ctx) => {
    ctx.fillStyle = "#20372b";
    ctx.fillRect(0, 0, 768, 192);
    ctx.strokeStyle = "#9c8452";
    ctx.lineWidth = 5;
    ctx.strokeRect(10, 10, 748, 172);
    ctx.fillStyle = "#e3d3a9";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 74px Georgia, serif";
    ctx.fillText(text, 384, 99, 700);
  });
  const surface = new THREE.MeshStandardMaterial({ map, roughness: 0.92 });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, width / 4), surface);
}
export function tableStatus(text: string) {
  const map = canvasTexture(1024, 160, (ctx) => {
    ctx.fillStyle = "#e6d9bc";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "96px Georgia, serif";
    ctx.fillText(text, 512, 80, 960);
  });
  return new THREE.Mesh(
    new THREE.PlaneGeometry(1.85, 0.25),
    new THREE.MeshStandardMaterial({
      map,
      transparent: true,
      depthWrite: false,
      roughness: 1,
      opacity: 0.85,
    }),
  );
}
export const material = (color: number, roughness = 0.8) =>
  new THREE.MeshStandardMaterial({ color, roughness });

export function createBallMaterials() {
  return ballColors.map((color, id) => {
    const map = canvasTexture(512, 256, (ctx) => {
      ctx.fillStyle = id > 8 ? "#eee9d9" : color;
      ctx.fillRect(0, 0, 512, 256);
      if (id > 8) {
        ctx.fillStyle = color;
        ctx.fillRect(0, 68, 512, 120);
      }
      if (id)
        for (const x of [128, 384]) {
          ctx.fillStyle = "#faf4e2";
          ctx.beginPath();
          ctx.arc(x, 128, 30, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#17201c";
          ctx.font = "bold 39px Arial";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(id), x, 130);
        }
    });
    map.anisotropy = 8;
    return new THREE.MeshPhysicalMaterial({
      map,
      roughness: 0.24,
      metalness: 0,
      specularIntensity: 0.3,
      clearcoat: 0.08,
      clearcoatRoughness: 0.16,
    });
  });
}
