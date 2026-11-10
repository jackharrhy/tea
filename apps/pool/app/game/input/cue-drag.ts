type Point = { x: number; y: number };
type Shot = { table: string; turn: number; angle: number };

export class CueDrag {
  private readonly start: Point;
  private readonly direction: Point;
  readonly shot: Readonly<Shot>;
  private readonly pullLength: number;

  constructor(start: Point, direction: Point, shot: Shot, pullLength: number) {
    const length = Math.hypot(direction.x, direction.y);
    if (!Number.isFinite(length) || length <= 0)
      throw new RangeError(
        "Shot direction must have a finite, positive length",
      );
    if (!Number.isFinite(pullLength) || pullLength <= 0)
      throw new RangeError("Pull length must be finite and positive");
    this.start = { ...start };
    this.direction = { x: direction.x / length, y: direction.y / length };
    this.shot = Object.freeze({ ...shot });
    this.pullLength = Math.min(180, Math.max(90, pullLength));
  }

  update(point: Point): number {
    const backward =
      (this.start.x - point.x) * this.direction.x +
      (this.start.y - point.y) * this.direction.y;
    if (backward < 6) return 0;
    return Math.min(1, Math.max(0.05, backward / this.pullLength));
  }

  release(point: Point): (Shot & { power: number }) | null {
    const power = this.update(point);
    return power > 0 ? { ...this.shot, power } : null;
  }
}
