interface Viewer {
  backgroundColor: number[];
  load(model: string): void;
  setResolution(width: number, height: number): void;
  setTurntableCamera(
    radius: number,
    spin: number,
    tilt: number,
    target: { x: number; y: number; z: number },
  ): void;
  setLightDirectionFromCamera(): void;
  startDrawLoop(before: (dt: number) => void, after?: () => void): void;
  stopDrawLoop(): void;
}
declare const PicoCADViewer: {
  new (options: {
    canvas: HTMLCanvasElement;
    fov: number;
    resolution: { width: number; height: number };
  }): Viewer;
};
export default PicoCADViewer;
