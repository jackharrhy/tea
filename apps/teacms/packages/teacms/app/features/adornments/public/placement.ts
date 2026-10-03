const keys = new Set([
  "width",
  "height",
  "top",
  "right",
  "bottom",
  "left",
  "rotation",
  "border",
  "filter",
  "padding",
  "margin",
]);
export function validPlacement(
  value: unknown,
): value is Record<string, string | number> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.entries(value).every(
      ([key, v]) =>
        keys.has(key) &&
        (typeof v === "number"
          ? Number.isFinite(v) && Math.abs(v) <= 10000
          : typeof v === "string" &&
            v.length <= 500 &&
            !/[;{}<>]|url\s*\(|expression\s*\(/i.test(v)),
    )
  );
}
