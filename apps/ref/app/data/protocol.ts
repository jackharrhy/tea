export interface ItemGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z: number;
}

export interface BoardItem extends ItemGeometry {
  id: string;
  assetId: string;
  filename: string;
  revision: number;
  link?: LinkPreview;
}

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  imageUrl: string | null;
  siteName: string;
}

export interface BoardSnapshot {
  boardId: string;
  sequence: number;
  items: BoardItem[];
}

export type BoardOperation =
  | {
      kind: "create";
      operationId: string;
      item: ItemGeometry & Pick<BoardItem, "id" | "assetId">;
    }
  | ({
      kind: "transform";
      operationId: string;
      itemId: string;
      baseRevision: number;
    } & ItemGeometry)
  | {
      kind: "remove";
      operationId: string;
      itemId: string;
      baseRevision: number;
    };

export type BoardServerFrame =
  | { type: "ready"; snapshot: BoardSnapshot }
  | { type: "pong" }
  | {
      type: "applied";
      operationId: string;
      sequence: number;
      item: BoardItem | null;
      itemId: string;
    }
  | {
      type: "rejected";
      operationId: string;
      reason: string;
      snapshot: BoardSnapshot;
    }
  | { type: "error"; message: string };

export function parseOperation(value: unknown): BoardOperation | null {
  if (!isRecord(value) || !isUuid(value.operationId)) return null;
  if (value.kind === "create" && isRecord(value.item)) {
    const item = value.item;
    if (!isUuid(item.id) || !isUuid(item.assetId) || !validGeometry(item))
      return null;
    return {
      kind: "create",
      operationId: value.operationId,
      item: {
        id: item.id,
        assetId: item.assetId,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        rotation: item.rotation,
        z: item.z,
      },
    };
  }
  if (
    value.kind === "transform" &&
    isUuid(value.itemId) &&
    validRevision(value.baseRevision) &&
    validGeometry(value)
  ) {
    return {
      kind: "transform",
      operationId: value.operationId,
      itemId: value.itemId,
      baseRevision: value.baseRevision,
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height,
      rotation: value.rotation,
      z: value.z,
    };
  }
  if (
    value.kind === "remove" &&
    isUuid(value.itemId) &&
    validRevision(value.baseRevision)
  ) {
    return {
      kind: "remove",
      operationId: value.operationId,
      itemId: value.itemId,
      baseRevision: value.baseRevision,
    };
  }
  return null;
}

function validGeometry(
  value: Record<string, unknown>,
): value is Record<"x" | "y" | "width" | "height" | "rotation" | "z", number> &
  Record<string, unknown> {
  const numbers = [
    value.x,
    value.y,
    value.width,
    value.height,
    value.rotation,
    value.z,
  ];
  if (
    !numbers.every(
      (number) =>
        typeof number === "number" &&
        Number.isFinite(number) &&
        Math.abs(number) <= 1_000_000,
    )
  )
    return false;
  return (
    (value.width as number) >= 24 &&
    (value.width as number) <= 20_000 &&
    (value.height as number) >= 24 &&
    (value.height as number) <= 20_000 &&
    Number.isInteger(value.z) &&
    Math.abs(value.rotation as number) <= 360_000
  );
}

function validRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
  );
}
