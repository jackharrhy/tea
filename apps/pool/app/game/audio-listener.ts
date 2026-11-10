type Point = { x: number; z: number };
type Vector = { x: number; y: number; z: number };

export function listenerPose(
  player: Point,
  table: Point | null,
  cameraForward: Vector,
  feltHeight: number,
) {
  const horizontal = Math.hypot(cameraForward.x, cameraForward.z);
  const forward =
    horizontal > 0.001
      ? {
          x: cameraForward.x / horizontal,
          y: 0,
          z: cameraForward.z / horizontal,
        }
      : { x: 0, y: 0, z: -1 };
  return {
    position: table
      ? {
          x: table.x - forward.x * 0.35,
          y: feltHeight + 0.55,
          z: table.z - forward.z * 0.35,
        }
      : { x: player.x, y: 1.35, z: player.z },
    forward,
  };
}
