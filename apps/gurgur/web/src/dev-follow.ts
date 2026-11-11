import type { RuntimeId } from "@harrhy/gurgur-engine";

export const DEV_FOLLOW_DEFAULT_YAW = 0;
export const DEV_FOLLOW_DEFAULT_PITCH = -0.18;
const DEV_FOLLOW_MIN_PITCH = -1.35;
const DEV_FOLLOW_MAX_PITCH = 1.35;

export type DevFollowCamera = {
  target: RuntimeId;
  yaw: number;
  pitch: number;
};

export function parseDevFollowCamera(
  searchParams: URLSearchParams,
): DevFollowCamera | null {
  const encodedTarget = searchParams.get("follow");
  if (encodedTarget === null) return null;
  const match = /^([0-9]+):([0-9]+)$/.exec(encodedTarget);
  if (!match) return null;
  const index = Number(match[1]);
  const generation = Number(match[2]);
  if (!uint32(index) || !uint32(generation)) return null;

  const yaw = optionalFinite(searchParams.get("yaw"), DEV_FOLLOW_DEFAULT_YAW);
  const pitch = optionalFinite(
    searchParams.get("pitch"),
    DEV_FOLLOW_DEFAULT_PITCH,
  );
  if (
    yaw === null ||
    pitch === null ||
    pitch < DEV_FOLLOW_MIN_PITCH ||
    pitch > DEV_FOLLOW_MAX_PITCH
  )
    return null;

  return {
    target: { index, generation },
    yaw,
    pitch,
  };
}

function optionalFinite(value: string | null, fallback: number): number | null {
  if (value === null) return fallback;
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function uint32(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 0xffff_ffff;
}
