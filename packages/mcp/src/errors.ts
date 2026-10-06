/** Tool failures are returned to the model; protocol failures are not. */
const toolErrorTag = Symbol("ToolError");
const forbiddenErrorTag = Symbol("ForbiddenError");
const invalidArgumentsErrorTag = Symbol("InvalidArgumentsError");

export interface ToolError extends Error {
  name: "ToolError";
}

export function createToolError(message: string): ToolError {
  return Object.assign(new Error(message), {
    name: "ToolError" as const,
    [toolErrorTag]: true,
  });
}

export function isToolError(error: unknown): error is ToolError {
  return error instanceof Error && toolErrorTag in error;
}

export interface ForbiddenError extends Error {
  name: "ForbiddenError";
}

export function createForbiddenError(message: string): ForbiddenError {
  return Object.assign(new Error(message), {
    name: "ForbiddenError" as const,
    [forbiddenErrorTag]: true,
  });
}

export function isForbiddenError(error: unknown): error is ForbiddenError {
  return error instanceof Error && forbiddenErrorTag in error;
}

export interface InvalidArgumentsError extends Error {
  name: "InvalidArgumentsError";
  readonly issues: readonly string[];
}

export function createInvalidArgumentsError(
  issues: readonly string[],
): InvalidArgumentsError {
  return Object.assign(new Error(`Invalid arguments: ${issues.join("; ")}`), {
    name: "InvalidArgumentsError" as const,
    issues,
    [invalidArgumentsErrorTag]: true,
  });
}

export function isInvalidArgumentsError(
  error: unknown,
): error is InvalidArgumentsError {
  return error instanceof Error && invalidArgumentsErrorTag in error;
}
