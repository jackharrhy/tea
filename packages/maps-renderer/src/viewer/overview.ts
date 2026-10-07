import { mat4 } from "wgpu-matrix";

import type { OverviewLayout, Vec3Tuple } from "../core/index.js";
import type { CameraState, OverviewImageType } from "./types.js";

export function overviewProjectionView(layout: OverviewLayout): Float32Array {
  const target: Vec3Tuple = [
    layout.origin[0],
    layout.origin[1],
    layout.origin[2],
  ];
  const up: Vec3Tuple = layout.rotation === 0 ? [0, 1, 0] : [1, 0, 0];
  const view = mat4.lookAt(layout.eye, target, up);
  const projection = mat4.ortho(
    -layout.viewWidth * 0.5,
    layout.viewWidth * 0.5,
    -layout.viewHeight * 0.5,
    layout.viewHeight * 0.5,
    1,
    layout.eye[2] - Math.min(layout.bounds.min[2], layout.zMin) + 1024,
  );
  return mat4.multiply(projection, view);
}

export function overviewCamera(layout: OverviewLayout): CameraState {
  return {
    position: layout.eye,
    yaw: 0,
    pitch: -Math.PI / 2,
    fieldOfView: 75,
  };
}

export async function overviewBlob(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  type: OverviewImageType,
  quality?: number,
): Promise<Blob> {
  const pixels = new Uint8ClampedArray(rgba.length);
  pixels.set(rgba);
  const imageData = new ImageData(pixels, width, height);
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error(
        "Worldview could not initialize an overview image encoder",
      );
    context.putImageData(imageData, 0, 0);
    return canvas.convertToBlob({
      type,
      ...(quality === undefined ? {} : { quality }),
    });
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context)
    throw new Error("Worldview could not initialize an overview image encoder");
  context.putImageData(imageData, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Worldview could not encode overview")),
      type,
      quality,
    );
  });
}
