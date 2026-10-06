/**
 * The failure a conversion reports, kept in its own module so the schema machinery
 * and the public converter construct it without importing each other.
 */

/** A schema, or a schema nested in it, that has no JSON Schema form. */
export interface JSONSchemaConversionError extends Error {
  name: "JSONSchemaConversionError";
  readonly path: readonly (string | number)[];
}

export function createJSONSchemaConversionError(
  message: string,
  path: readonly (string | number)[] = [],
  options?: ErrorOptions,
): JSONSchemaConversionError {
  return Object.assign(new Error(message, options), {
    name: "JSONSchemaConversionError" as const,
    path,
  });
}

/**
 * Formats schema path segments as an RFC 6901 JSON Pointer, `""` for the root.
 *
 * @param path - The segments, outermost first.
 * @example toPointer(["properties", "a/b"]); // "/properties/a~1b"
 */
export function toPointer(path: readonly (string | number)[]): string {
  return path
    .map(
      (segment) =>
        `/${String(segment).replaceAll("~", "~0").replaceAll("/", "~1")}`,
    )
    .join("");
}
