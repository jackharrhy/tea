import type { CameraState } from "@tea/maps-renderer";
import { localMapPath } from "./world-input.ts";

export interface LocalMapMetadata {
  readonly label: string;
  readonly camera?: CameraState;
  readonly walkability?: File;
}

function cameraFromMetadata(
  value: unknown,
  filename: string,
): CameraState | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object")
    throw new Error(`${filename}: camera must be an object`);
  const camera = value as Record<string, unknown>;
  const position = camera.position;
  if (
    !Array.isArray(position) ||
    position.length !== 3 ||
    !position.every((part) => typeof part === "number" && Number.isFinite(part))
  ) {
    throw new Error(
      `${filename}: camera.position must contain three finite numbers`,
    );
  }
  const yawDegrees = camera.yawDegrees ?? 0;
  const pitchDegrees = camera.pitchDegrees ?? 0;
  const fieldOfView = camera.fieldOfView ?? 75;
  if (
    typeof yawDegrees !== "number" ||
    !Number.isFinite(yawDegrees) ||
    typeof pitchDegrees !== "number" ||
    !Number.isFinite(pitchDegrees) ||
    typeof fieldOfView !== "number" ||
    !Number.isFinite(fieldOfView)
  ) {
    throw new Error(
      `${filename}: camera angles and field of view must be finite numbers`,
    );
  }
  return {
    position: position as [number, number, number],
    yaw: (yawDegrees * Math.PI) / 180,
    pitch: (pitchDegrees * Math.PI) / 180,
    fieldOfView,
  };
}

export async function localMapMetadata(
  files: Iterable<File>,
  bsp: File,
): Promise<LocalMapMetadata> {
  const list = [...files];
  const stem = localMapPath(bsp).replace(/\.bsp$/iu, "");
  const sidecar = list.find(
    (file) =>
      localMapPath(file).toLowerCase() ===
      `${stem}.tea-maps.json`.toLowerCase(),
  );
  const walkability = list.find(
    (file) =>
      localMapPath(file).toLowerCase() ===
      `${stem}.tea-maps-walkability.json`.toLowerCase(),
  );
  if (!sidecar) {
    return {
      label: localMapPath(bsp),
      ...(walkability ? { walkability } : {}),
    };
  }
  let metadata: unknown;
  try {
    metadata = JSON.parse(await sidecar.text());
  } catch {
    throw new Error(`${localMapPath(sidecar)}: invalid JSON`);
  }
  const sidecarName = localMapPath(sidecar);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    throw new Error(`${sidecarName}: metadata must be an object`);
  const record = metadata as Record<string, unknown>;
  const label = record.label ?? localMapPath(bsp);
  if (typeof label !== "string" || !label.trim())
    throw new Error(`${sidecarName}: label must be a non-empty string`);
  const camera = cameraFromMetadata(record.camera, sidecarName);
  return {
    label: label.trim(),
    ...(camera ? { camera } : {}),
    ...(walkability ? { walkability } : {}),
  };
}
