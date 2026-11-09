import * as THREE from "three/webgpu";
import { TABLES } from "@tea/pool-simulation/geometry";

function noise(x: number, y: number) {
  const hash = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return hash - Math.floor(hash);
}

function sample(x: number, y: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y);
  const fx = x - ix,
    fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx),
    sy = fy * fy * (3 - 2 * fy);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(noise(ix, iy), noise(ix + 1, iy), sx),
    THREE.MathUtils.lerp(noise(ix, iy + 1), noise(ix + 1, iy + 1), sx),
    sy,
  );
}

function smokeTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(128, 128);
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++) {
      let density = 0,
        weight = 0.55;
      for (let scale = 4; scale <= 32; scale *= 2) {
        density += sample((x / 128) * scale, (y / 128) * scale) * weight;
        weight *= 0.5;
      }
      const edge = Math.max(0, 1 - Math.hypot((x - 64) / 64, (y - 64) / 64));
      const i = (y * 128 + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = 255;
      image.data[i + 3] = Math.min(
        255,
        Math.max(0, density - 0.22) * 600 * edge ** 1.6,
      );
    }
  ctx.putImageData(image, 0, 0);
  return new THREE.CanvasTexture(canvas);
}

export function createSmoke(scene: THREE.Scene) {
  const map = smokeTexture();
  const particles = TABLES.flatMap((table, index) =>
    Array.from({ length: 5 }, (_, i) => {
      const material = new THREE.SpriteNodeMaterial({
        map,
        color: 0xc5a17d,
        transparent: true,
        depthWrite: false,
        opacity: 0,
      });
      const sprite = new THREE.Sprite(material);
      scene.add(sprite);
      return {
        sprite,
        table,
        phase: (i * 0.618 + index * 0.21) % 1,
        seed: i + index * 8,
      };
    }),
  );
  let elapsed = 0;
  return (dt: number, camera: THREE.Camera) => {
    elapsed += dt;
    for (const { sprite, table, phase, seed } of particles) {
      const life = (phase + elapsed * 0.0015) % 1;
      sprite.position.set(
        table.x + Math.sin(seed * 7.3 + life * 2.3) * 1.6 + life * 0.7,
        1.65 + life * 2.5,
        table.z + Math.cos(seed * 4.7 + life * 1.8) * 1.8,
      );
      sprite.scale.setScalar(2.6 + life * 2.6);
      sprite.material.rotation = seed * 1.7 + elapsed * 0.0015;
      const nearFade = THREE.MathUtils.smoothstep(
        camera.position.distanceTo(sprite.position),
        1.5,
        5,
      );
      sprite.material.opacity = Math.sin(life * Math.PI) * 0.038 * nearFade;
    }
  };
}
