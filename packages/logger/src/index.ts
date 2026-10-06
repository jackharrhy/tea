import { AsyncLocalStorage } from "node:async_hooks";

const MAX_NOTES = 200;

export type LogKind = "request" | "cron" | "queue" | "job" | "alarm";
export type LogOutcome = "ok" | "degraded" | "error";
export type LogValue = string | number | boolean | null;
export type LogFields = Record<
  string,
  LogValue | undefined | Record<string, LogValue | undefined>
>;

export interface LogNote {
  at: number;
  level: "info" | "warn" | "error";
  name: string;
  [key: string]: LogValue | undefined;
}

export interface SampleOptions {
  rate?: number;
  slowerThanMs?: number;
  keep?: (fields: Readonly<Record<string, LogValue>>) => boolean;
}

export interface LogOptions {
  kind: LogKind;
  service?: string;
  environment?: string;
  version?: string;
  sample?: SampleOptions;
  sink?: (
    record: Readonly<Record<string, unknown>>,
    outcome: LogOutcome,
  ) => void;
}

export interface LoggerOptions extends Omit<LogOptions, "kind" | "service"> {
  service: string;
}

export interface Log {
  readonly kind: LogKind;
  readonly outcome: LogOutcome;
  readonly parent: Log | undefined;
  set(fields: LogFields): Log;
  inc(field: string, by?: number): Log;
  time<T>(name: string, fn: () => T | Promise<T>): Promise<T>;
  note(name: string, fields?: Record<string, LogValue | undefined>): Log;
  warn(name: string, fields?: Record<string, LogValue | undefined>): Log;
  fail(error: unknown, fields?: LogFields): Log;
  child(kind: LogKind, fields?: LogFields): Log;
  run<T>(fn: (log: Log) => T | Promise<T>): Promise<T>;
  emit(): void;
}

export interface Logger {
  readonly options: Readonly<LoggerOptions>;
  open(kind: LogKind, fields?: LogFields): Log;
  request(
    request: Request,
    handle: (log: Log) => Response | Promise<Response>,
  ): Promise<Response>;
}

const storage = new AsyncLocalStorage<Log>();

export function createLogger(options: LoggerOptions): Logger {
  const logger: Logger = {
    options,
    open(kind, fields) {
      return createLog({ ...options, kind }, fields);
    },
    request(request, handle) {
      return logger
        .open("request", { http: { method: request.method } })
        .run(async (log) => {
          const response = await handle(log);
          log.set({ http: { status: response.status } });
          return response;
        });
    },
  };
  return logger;
}

export function currentLog(): Log | undefined {
  return storage.getStore();
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

function errorFields(error: unknown) {
  if (typeof error !== "object" || error === null) return {};
  const code: unknown = Reflect.get(error, "code");
  const retriable: unknown = Reflect.get(error, "retriable");
  return {
    code:
      typeof code === "string" || typeof code === "number" ? code : undefined,
    retriable: typeof retriable === "boolean" ? retriable : undefined,
  };
}

function writeToConsole(
  record: Readonly<Record<string, unknown>>,
  outcome: LogOutcome,
): void {
  if (outcome === "error") console.error(record);
  else if (outcome === "degraded") console.warn(record);
  else console.log(record);
}

function shouldKeep(
  options: SampleOptions | undefined,
  outcome: LogOutcome,
  fields: Readonly<Record<string, LogValue>>,
  durationMs: number,
): boolean {
  if (outcome !== "ok" || options === undefined) return true;
  if (options.keep?.(fields) === true) return true;
  if (options.slowerThanMs !== undefined && durationMs >= options.slowerThanMs)
    return true;
  return options.rate === undefined || Math.random() < options.rate;
}

export function createLog(options: LogOptions, fields?: LogFields): Log {
  return openLog(options, fields);
}

function openLog(
  options: LogOptions,
  initialFields?: LogFields,
  parent?: Log,
  degradeParent?: () => void,
): Log {
  const started = performance.now();
  const fields = new Map<string, LogValue>();
  const notes: LogNote[] = [];
  let droppedNotes = 0;
  let outcome: LogOutcome = "ok";
  let emitted = false;

  function addNote(
    level: LogNote["level"],
    name: string,
    values?: Record<string, LogValue | undefined>,
  ): void {
    if (notes.length >= MAX_NOTES) {
      droppedNotes++;
      return;
    }
    notes.push({
      ...values,
      at: round(performance.now() - started),
      level,
      name,
    });
  }

  const log: Log = {
    kind: options.kind,
    get outcome() {
      return outcome;
    },
    get parent() {
      return parent;
    },
    set(values) {
      for (const [key, value] of Object.entries(values)) {
        if (value === undefined) continue;
        if (typeof value === "object" && value !== null) {
          for (const [nested, inner] of Object.entries(value)) {
            if (inner !== undefined) fields.set(`${key}.${nested}`, inner);
          }
        } else {
          fields.set(key, value);
        }
      }
      return log;
    },
    inc(field, by = 1) {
      const current = fields.get(field);
      fields.set(field, (typeof current === "number" ? current : 0) + by);
      return log;
    },
    async time(name, fn) {
      const start = performance.now();
      try {
        return await fn();
      } finally {
        log.inc(`${name}.count`);
        log.inc(`${name}.duration_ms`, round(performance.now() - start));
      }
    },
    note(name, values) {
      addNote("info", name, values);
      return log;
    },
    warn(name, values) {
      addNote("warn", name, values);
      if (outcome === "ok") outcome = "degraded";
      return log;
    },
    fail(error, values) {
      outcome = "error";
      // Exception messages and stacks can contain request data or credentials.
      log.set({
        error: {
          type: error instanceof Error ? error.name : "UnknownError",
          ...errorFields(error),
        },
      });
      if (values !== undefined) log.set(values);
      return log;
    },
    child(kind, values) {
      return openLog({ ...options, kind }, values, log, () => {
        if (outcome === "ok") outcome = "degraded";
      });
    },
    run(fn) {
      return storage.run(log, async () => {
        try {
          return await fn(log);
        } catch (error) {
          log.fail(error);
          throw error;
        } finally {
          log.emit();
        }
      });
    },
    emit() {
      if (emitted) return;
      emitted = true;

      const duration = round(performance.now() - started);
      const values = Object.fromEntries(fields) as Record<string, LogValue>;
      values.kind = log.kind;
      parent?.inc(`${log.kind}.count`);
      if (outcome !== "ok") degradeParent?.();
      if (!shouldKeep(options.sample, outcome, values, duration)) return;

      const record: Record<string, unknown> = Object.fromEntries(fields);
      record.kind = log.kind;
      record.outcome = outcome;
      record.duration_ms = duration;
      if (options.service !== undefined) record.service = options.service;
      if (options.environment !== undefined)
        record.environment = options.environment;
      if (options.version !== undefined) record.version = options.version;
      if (notes.length > 0) record.notes = notes;
      if (droppedNotes > 0) record["notes.dropped"] = droppedNotes;
      (options.sink ?? writeToConsole)(record, outcome);
    },
  };

  if (initialFields !== undefined) log.set(initialFields);
  return log;
}
