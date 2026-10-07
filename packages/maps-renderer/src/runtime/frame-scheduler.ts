export interface AnimationFrameTarget {
  /** Renders one frame and returns true only while another frame is immediately required. */
  render(time: number): boolean;
}

type RequestFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (handle: number) => void;

/** Coalesces visual invalidations and sleeps completely while its target is idle. */
export class AnimationFrameScheduler {
  private target: AnimationFrameTarget | null = null;
  private pendingFrame: number | null = null;
  private enabled = false;
  private disposed = false;

  public constructor(
    private readonly requestFrame: RequestFrame = (callback) =>
      requestAnimationFrame(callback),
    private readonly cancelFrame: CancelFrame = (handle) =>
      cancelAnimationFrame(handle),
  ) {}

  public setTarget(target: AnimationFrameTarget): void {
    this.target = target;
    this.request();
  }

  public start(): void {
    if (this.disposed) return;
    this.enabled = true;
    this.request();
  }

  public stop(): void {
    this.enabled = false;
    if (this.pendingFrame === null) return;
    this.cancelFrame(this.pendingFrame);
    this.pendingFrame = null;
  }

  /** Returns true when this request woke an idle scheduler. */
  public request(): boolean {
    if (
      this.disposed ||
      !this.enabled ||
      !this.target ||
      this.pendingFrame !== null
    )
      return false;
    this.pendingFrame = this.requestFrame((time) => {
      this.pendingFrame = null;
      if (!this.enabled || this.disposed) return;
      if (this.target?.render(time)) this.request();
    });
    return true;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.disposed = true;
    this.target = null;
  }
}
