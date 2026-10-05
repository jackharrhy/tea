/**
 * Public entry point for the result package: constructors, type guards,
 * and combinators for working with `Result` values.
 */

export type { Success, Failure, Result } from "./types.ts";
export { success } from "./success.ts";
export { failure } from "./failure.ts";
export { isSuccess } from "./is-success.ts";
export { isFailure } from "./is-failure.ts";
export { succeeded } from "./succeeded.ts";
export { failed } from "./failed.ts";
export { unwrap } from "./unwrap.ts";
export { match } from "./match.ts";
export { retry, RetryError } from "./retry.ts";
export { wrap } from "./wrap.ts";
export { partition } from "./partition.ts";
