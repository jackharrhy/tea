import type { PoolSound } from "@harrhy/pool";
import { RETURNS, MESH_REST_OFFSET } from "@harrhy/pool/table";
import { Quaternion, Vector3 } from "three";

// The shared receiving floor is the widest chute, not an inbound lane or boot.
export const RETURN_FLOOR = RETURNS.filter(
  (part) => part.kind === "chute",
).reduce((widest, part) => (part.size[0] > widest.size[0] ? part : widest));
const rotation = new Quaternion(...RETURN_FLOOR.rotation);
const inverse = rotation.clone().invert();
export const RETURN_FLOOR_POINT = new Vector3(0, RETURN_FLOOR.size[1] / 2, 0)
  .applyQuaternion(rotation)
  .add(new Vector3(...RETURN_FLOOR.center));

// Input is a table-local contact point, not a ball center or hall coordinate.
export function isReturnFloorLanding(sound: PoolSound) {
  if (
    sound.kind !== "return" ||
    ![sound.x, sound.y, sound.z].every(Number.isFinite)
  )
    return false;
  const point = new Vector3(sound.x, sound.y, sound.z)
    .sub(new Vector3(...RETURN_FLOOR.center))
    .applyQuaternion(inverse);
  return (
    Math.abs(point.x) <= RETURN_FLOOR.size[0] / 2 &&
    Math.abs(point.z) <= RETURN_FLOOR.size[2] / 2 &&
    Math.abs(point.y - RETURN_FLOOR.size[1] / 2) <= MESH_REST_OFFSET
  );
}
