export interface Success<T> {
  status: "success";
  data: T;
}

export interface Failure<E extends Error> {
  status: "failure";
  error: E;
}

export type Result<T, E extends Error> = Success<T> | Failure<E>;

export function success<T>(data: T): Success<T> {
  return { status: "success", data };
}

export function failure<E extends Error>(error: E): Failure<E> {
  return { status: "failure", error };
}

export function isSuccess<T, E extends Error>(
  result: Result<T, E>,
): result is Success<T> {
  return result.status === "success";
}

export function isFailure<T, E extends Error>(
  result: Result<T, E>,
): result is Failure<E> {
  return result.status === "failure";
}

export function succeeded<T, E extends Error>(
  result: Result<T, E>,
  message = "Result is a failure",
): asserts result is Success<T> {
  if (isFailure(result)) throw new Error(message, { cause: result.error });
}

export function failed<T, E extends Error>(
  result: Result<T, E>,
  message = "Result is a success",
): asserts result is Failure<E> {
  if (isSuccess(result)) throw new Error(message, { cause: result.data });
}

export function unwrap<T, E extends Error>(
  result: Result<T, E>,
  fallback?: (error: E) => T,
): T;
export function unwrap<T, E extends Error>(
  result: Promise<Result<T, E>>,
  fallback?: (error: E) => T,
): Promise<T>;
export function unwrap<T, E extends Error>(
  result: Result<T, E> | Promise<Result<T, E>>,
  fallback?: (error: E) => T,
): T | Promise<T> {
  if (result instanceof Promise)
    return result.then((value) => unwrap(value, fallback));
  if (isSuccess(result)) return result.data;
  if (fallback) return fallback(result.error);
  throw result.error;
}

export function match<T, E extends Error, R>(
  result: Result<T, E>,
  handlers: { success: (data: T) => R; failure: (error: E) => R },
): R;
export function match<T, E extends Error, R>(
  result: Promise<Result<T, E>>,
  handlers: { success: (data: T) => R; failure: (error: E) => R },
): Promise<R>;
export function match<T, E extends Error, R>(
  result: Result<T, E> | Promise<Result<T, E>>,
  handlers: { success: (data: T) => R; failure: (error: E) => R },
): R | Promise<R> {
  if (result instanceof Promise)
    return result.then((value) => match(value, handlers));
  if (isSuccess(result)) return handlers.success(result.data);
  return handlers.failure(result.error);
}

type IsAny<T> = 0 extends 1 & T ? true : false;

export type WrapResult<T> =
  IsAny<T> extends true
    ? Result<any, Error>
    : [T] extends [never]
      ? Result<never, Error>
      : T extends PromiseLike<infer U>
        ? Promise<Result<U, Error>>
        : Result<T, Error>;

export function wrap<T>(fn: () => T): WrapResult<T>;
export function wrap(
  fn: () => unknown,
): Result<unknown, Error> | Promise<Result<unknown, Error>> {
  try {
    const value = fn();
    if (value instanceof Promise) return value.then(success).catch(failure);
    return success(value);
  } catch (error) {
    if (error instanceof Error) return failure(error);
    return failure(new Error(String(error)));
  }
}

export function partition<T, E extends Error>(
  results: Result<T, E>[],
): [T[], E[]] {
  const successes = new Set<Success<T>>();
  const failures = new Set<Failure<E>>();
  for (const result of results) {
    if (isSuccess(result)) successes.add(result);
    if (isFailure(result)) failures.add(result);
  }
  return [
    Array.from(successes, (result) => result.data),
    Array.from(failures, (result) => result.error),
  ];
}

export interface RetryError extends Error {
  name: "RetryError";
}

export function createRetryError(attempts: number): RetryError {
  return Object.assign(new Error(`Failed after ${attempts} attempts`), {
    name: "RetryError" as const,
  });
}

export interface RetryOptions<E extends Error> {
  times: number;
  delay: number;
  backoff?: "constant" | "linear" | "exponential";
  when?: (error: E, attempts: number) => boolean;
}

export async function retry<T, E extends Error>(
  fn: () => Promise<Result<T, E>>,
  options: RetryOptions<E>,
): Promise<Result<T, E | RetryError>> {
  if (options.times <= 0)
    throw new RangeError("Retry times must be greater than 0");
  if (typeof options.delay !== "number") {
    throw new TypeError("Delay must be a number of milliseconds");
  }

  let attempts = 0;
  while (attempts < options.times) {
    const result = await fn();
    if (isSuccess(result)) return result;
    attempts++;
    if (options.when && !options.when(result.error, attempts)) break;

    const backoff = options.backoff ?? "exponential";
    let delay = options.delay;
    if (backoff === "linear") delay = options.delay * attempts;
    if (backoff === "exponential") delay = options.delay * 2 ** (attempts - 1);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  return failure(createRetryError(attempts));
}
