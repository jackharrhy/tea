import type { Handle } from "remix/component";
export function LocalTime(
  handle: Handle<{
    value: unknown;
    format?: "full" | "date" | "time" | "relative";
  }>,
) {
  return () => {
    if (!handle.props.value) return null;
    const input = String(handle.props.value).replace(" ", "T"),
      date = new Date(/(?:Z|[+-]\d\d:\d\d)$/.test(input) ? input : input + "Z");
    if (Number.isNaN(date.getTime())) return String(handle.props.value);
    const iso = date.toISOString().replace(/\.\d{3}Z$/, "Z"),
      format = handle.props.format ?? "full";
    const fallback =
      format === "date"
        ? iso.slice(0, 10)
        : format === "time"
          ? iso.slice(11, 16)
          : iso.slice(0, 16).replace("T", " ");
    return (
      <time datetime={iso} data-fmt={format}>
        {fallback}
      </time>
    );
  };
}
