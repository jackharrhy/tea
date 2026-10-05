import { AsyncLocalStorage } from "node:async_hooks";

const MAX_NOTES = 200;
const storage = new AsyncLocalStorage<Log>();

export namespace Sample {
  export interface Options {
    rate?: number;
    slowerThanMs?: number;
    keep?: (fields: Readonly<Record<string, Log.Value>>) => boolean;
  }
}

export namespace Log {
  export type Kind = "request" | "cron" | "queue" | "job" | "alarm";
  export type Outcome = "ok" | "degraded" | "error";
  export type Value = string | number | boolean | null;
  export type Fields = Record<
    string,
    Value | undefined | Record<string, Value | undefined>
  >;
  export interface Note {
    at: number;
    level: "info" | "warn" | "error";
    name: string;
    [key: string]: Value | undefined;
  }
  export type Sink = (
    record: Readonly<Record<string, unknown>>,
    outcome: Outcome,
  ) => void;
  export interface Options {
    kind: Kind;
    service?: string;
    environment?: string;
    version?: string;
    sample?: Sample.Options;
    sink?: Sink;
  }
}

export namespace Logger {
  export interface Options extends Omit<Log.Options, "kind" | "service"> {
    service: string;
  }
}

export interface Logger {
  readonly options: Readonly<Logger.Options>;
  open(kind: Log.Kind, fields?: Log.Fields): Log;
  request(
    request: Request,
    handle: (log: Log) => Response | Promise<Response>,
  ): Promise<Response>;
}

export function createLogger(options: Logger.Options): Logger {
  const logger: Logger = {
    options,
    open(kind, fields) {
      return new Log({ ...options, kind }, fields);
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
  outcome: Log.Outcome,
): void {
  if (outcome === "error") console.error(record);
  else if (outcome === "degraded") console.warn(record);
  else console.log(record);
}

function shouldKeep(
  options: Sample.Options | undefined,
  outcome: Log.Outcome,
  fields: Readonly<Record<string, Log.Value>>,
  durationMs: number,
): boolean {
  if (outcome !== "ok" || options === undefined) return true;
  if (options.keep?.(fields) === true) return true;
  if (options.slowerThanMs !== undefined && durationMs >= options.slowerThanMs)
    return true;
  return options.rate === undefined || Math.random() < options.rate;
}

export class Log {
  readonly kind: Log.Kind;
  readonly #options: Log.Options;
  readonly #started = performance.now();
  readonly #fields = new Map<string, Log.Value>();
  readonly #notes: Log.Note[] = [];
  #droppedNotes = 0;
  #outcome: Log.Outcome = "ok";
  #parent: Log | undefined;
  #emitted = false;

  constructor(options: Log.Options, fields?: Log.Fields) {
    this.#options = options;
    this.kind = options.kind;
    if (fields !== undefined) this.set(fields);
  }

  get outcome(): Log.Outcome {
    return this.#outcome;
  }

  get parent(): Log | undefined {
    return this.#parent;
  }

  set(fields: Log.Fields): this {
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      if (typeof value === "object" && value !== null) {
        for (const [nested, inner] of Object.entries(value)) {
          if (inner !== undefined) this.#fields.set(`${key}.${nested}`, inner);
        }
      } else {
        this.#fields.set(key, value);
      }
    }
    return this;
  }

  inc(field: string, by = 1): this {
    const current = this.#fields.get(field);
    this.#fields.set(field, (typeof current === "number" ? current : 0) + by);
    return this;
  }

  async time<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await fn();
    } finally {
      this.inc(`${name}.count`);
      this.inc(`${name}.duration_ms`, round(performance.now() - started));
    }
  }

  note(name: string, fields?: Record<string, Log.Value | undefined>): this {
    this.#note("info", name, fields);
    return this;
  }

  warn(name: string, fields?: Record<string, Log.Value | undefined>): this {
    this.#note("warn", name, fields);
    if (this.#outcome === "ok") this.#outcome = "degraded";
    return this;
  }

  fail(error: unknown, fields?: Log.Fields): this {
    this.#outcome = "error";
    // Exception messages and stacks can contain request data or credentials.
    this.set({
      error: {
        type: error instanceof Error ? error.name : "UnknownError",
        ...errorFields(error),
      },
    });
    if (fields !== undefined) this.set(fields);
    return this;
  }

  child(kind: Log.Kind, fields?: Log.Fields): Log {
    const child = new Log({ ...this.#options, kind }, fields);
    child.#parent = this;
    return child;
  }

  run<T>(fn: (log: this) => T | Promise<T>): Promise<T> {
    return storage.run(this, async () => {
      try {
        return await fn(this);
      } catch (error) {
        this.fail(error);
        throw error;
      } finally {
        this.emit();
      }
    });
  }

  emit(): void {
    if (this.#emitted) return;
    this.#emitted = true;

    const duration = round(performance.now() - this.#started);
    const fields = Object.fromEntries(this.#fields) as Record<
      string,
      Log.Value
    >;
    fields.kind = this.kind;
    this.#parent?.inc(`${this.kind}.count`);
    if (this.#outcome !== "ok" && this.#parent?.outcome === "ok") {
      this.#parent.#outcome = "degraded";
    }
    if (!shouldKeep(this.#options.sample, this.#outcome, fields, duration))
      return;

    const record: Record<string, unknown> = Object.fromEntries(this.#fields);
    record.kind = this.kind;
    record.outcome = this.#outcome;
    record.duration_ms = duration;
    if (this.#options.service !== undefined)
      record.service = this.#options.service;
    if (this.#options.environment !== undefined)
      record.environment = this.#options.environment;
    if (this.#options.version !== undefined)
      record.version = this.#options.version;
    if (this.#notes.length > 0) record.notes = this.#notes;
    if (this.#droppedNotes > 0) record["notes.dropped"] = this.#droppedNotes;
    (this.#options.sink ?? writeToConsole)(record, this.#outcome);
  }

  #note(
    level: Log.Note["level"],
    name: string,
    fields?: Record<string, Log.Value | undefined>,
  ): void {
    if (this.#notes.length >= MAX_NOTES) {
      this.#droppedNotes++;
      return;
    }
    this.#notes.push({
      ...fields,
      at: round(performance.now() - this.#started),
      level,
      name,
    });
  }
}
