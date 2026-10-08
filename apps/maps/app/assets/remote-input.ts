import type { CameraState, WorldSource } from "@tea/maps-renderer";

export function cameraFromUrlParameters(
  parameters: URLSearchParams,
): CameraState | undefined {
  const parts = parameters
    .get("camera")
    ?.split(",")
    .map((part) => part.trim());
  if (
    !parts ||
    parts.length !== 5 ||
    parts.some((part) => part === "" || !Number.isFinite(Number(part)))
  ) {
    return undefined;
  }
  const [x, y, z, yawDegrees, pitchDegrees] = parts.map(Number);
  return {
    position: [x!, y!, z!],
    yaw: (yawDegrees! * Math.PI) / 180,
    pitch: (pitchDegrees! * Math.PI) / 180,
    fieldOfView: 75,
  };
}

export function cameraUrlValue(camera: CameraState): string {
  return [
    ...camera.position.map((value) => value.toFixed(3)),
    ((camera.yaw * 180) / Math.PI).toFixed(2),
    ((camera.pitch * 180) / Math.PI).toFixed(2),
  ].join(",");
}

export function sourceFromUrlParameters(
  parameters: URLSearchParams,
): WorldSource | undefined {
  const bsp = parameters.get("bsp")?.trim();
  if (!bsp) return undefined;
  const gameBaseUrl = parameters.get("gameBase")?.trim();
  const palette = parameters.get("palette")?.trim();
  const wadBaseUrl = parameters.get("wadBase")?.trim();
  const skyboxBaseUrl = parameters.get("skyboxBase")?.trim();
  const spriteBaseUrl = parameters.get("spriteBase")?.trim();
  const soundBaseUrl = parameters.get("soundBase")?.trim();
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
