import type { z } from "zod";

export type ProtocolErrorCode =
  | "binary-frame"
  | "invalid-json"
  | "invalid-payload"
  | "payload-too-large";

export class MapsProtocolError extends Error {
  public constructor(
    public readonly code: ProtocolErrorCode,
    message: string,
    public readonly path?: string,
  ) {
    super(path ? `${message} at ${path}` : message);
    this.name = "MapsProtocolError";
  }
}

export function zodPath(issue: z.core.$ZodIssue): string | undefined {
  const parts = [...issue.path];
  if (issue.code === "unrecognized_keys" && issue.keys[0])
    parts.push(issue.keys[0]);
  if (parts.length === 0) return undefined;
  return parts
    .map((part, index) =>
      typeof part === "number"
        ? `[${part}]`
        : `${index > 0 ? "." : ""}${String(part)}`,
    )
    .join("")
    .replace(/\.\[/g, "[");
}
