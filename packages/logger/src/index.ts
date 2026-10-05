/**
 * Public entry point for the logger package: the worker's configuration, the wide event it
 * opens per invocation, and the accessor for the log the running invocation is recorded in.
 */

export type { Logger } from "./create-logger.ts";
export type { Sample } from "./sample.ts";

export { createLogger } from "./create-logger.ts";
export { currentLog } from "./current.ts";
export { Log } from "./log.ts";
