export type PlayerBillboardLayout = {
  readonly columns: number;
  readonly rows: number;
  readonly views: readonly {
    readonly viewDirection: {
      readonly x: number;
      readonly y: number;
      readonly z: number;
    };
  }[];
};

export function playerBillboardView(
  playerYaw: number,
  cameraX: number,
  cameraY: number,
  cameraZ: number,
  playerX: number,
  playerY: number,
  playerZ: number,
  views: PlayerBillboardLayout["views"],
): number {
  if (views.length < 1)
    throw new Error("billboard must contain at least one view");
  const worldX = cameraX - playerX;
  const worldY = cameraY - playerY;
  const worldZ = cameraZ - playerZ;
  const length = Math.hypot(worldX, worldY, worldZ);
  if (length < 1e-6) return 0;
  const sin = Math.sin(playerYaw);
  const cos = Math.cos(playerYaw);
  const localX = (cos * worldX - sin * worldZ) / length;
  const localY = worldY / length;
  const localZ = (sin * worldX + cos * worldZ) / length;
  let closest = 0;
  let closestDot = -Infinity;
  for (let index = 0; index < views.length; index += 1) {
    const direction = views[index]!.viewDirection;
    const dot =
      localX * direction.x + localY * direction.y + localZ * direction.z;
    if (dot > closestDot) {
      closest = index;
      closestDot = dot;
    }
  }
  return closest;
}

export function playerBillboardAtlasOffset(
  direction: number,
  layout: PlayerBillboardLayout,
): { x: number; y: number } {
  if (layout.columns < 1 || layout.rows < 1)
    throw new Error("atlas dimensions must be positive");
  if (
    !Number.isInteger(direction) ||
    direction < 0 ||
    direction >= layout.views.length
  )
    throw new Error("view is outside the atlas");
  const column = direction % layout.columns;
  const row = Math.floor(direction / layout.columns);
  return {
    x: column / layout.columns,
    y: 1 - (row + 1) / layout.rows,
  };
}
