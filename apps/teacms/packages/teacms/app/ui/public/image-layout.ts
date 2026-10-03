export type ImageLayout = Record<string, string | number | undefined>;

export function imageStyle(p: ImageLayout): ImageLayout {
  return {
    width: p.width,
    "max-height": p.height,
    padding: p.padding,
    margin: p.margin || "0 auto",
    top: p.top,
    right: p.right,
    bottom: p.bottom,
    left: p.left,
    filter: p.filter,
    border: p.border,
    transform: Number(p.rotation)
      ? `rotate(${Number(p.rotation)}deg)`
      : undefined,
  };
}
export function imageGroupStyle(p: ImageLayout): ImageLayout {
  return {
    width: p.width,
    padding: p.padding,
    margin: p.margin || "0 auto",
    transform: Number(p.rotation)
      ? `rotate(${Number(p.rotation)}deg)`
      : undefined,
  };
}
export function decoratedPhotoStyle(p: ImageLayout): ImageLayout {
  return { filter: p.filter, "max-height": p.height, border: p.border };
}
export function adornmentStyle(p: ImageLayout): ImageLayout {
  return {
    ...imageStyle(p),
    position: "absolute",
    height: p.height,
    margin: p.margin,
  };
}
export function domStyle(style: ImageLayout): ImageLayout {
  return Object.fromEntries(
    Object.entries(style).map(([key, value]) => [
      key.replace(/-([a-z])/g, (_, c) => c.toUpperCase()),
      value,
    ]),
  );
}
export function localPointerDelta(
  dx: number,
  dy: number,
  degrees: number,
  scale: number,
) {
  const angle = (degrees * Math.PI) / 180;
  return {
    x: (dx * Math.cos(angle) + dy * Math.sin(angle)) / scale,
    y: (-dx * Math.sin(angle) + dy * Math.cos(angle)) / scale,
  };
}
