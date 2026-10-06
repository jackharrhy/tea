export type Field = {
  name: string;
  label: string;
  type:
    | "text"
    | "textarea"
    | "url"
    | "datetime"
    | "number"
    | "boolean"
    | "select"
    | "media";
  required?: boolean;
  options?: readonly string[];
};

export type Collection = {
  name: string;
  label: string;
  fields: readonly Field[];
};

export type Entry = {
  collection: string;
  slug: string;
  data: Record<string, string | number | boolean>;
  revision: number;
  publishedAt: string | null;
};

type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
};

export type D1Database = {
  prepare(sql: string): D1Statement;
  batch(statements: D1Statement[]): Promise<unknown>;
};

type R2Object = {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
  size: number;
};
type R2Bucket = {
  put(
    key: string,
    value: ArrayBuffer | ReadableStream,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<R2Object | null>;
  delete(key: string): Promise<void>;
};

export type Bindings = {
  DB: D1Database;
  MEDIA: R2Bucket;
  TEA_ADMIN_PASSWORD: string;
  TEA_SESSION_SECRET: string;
  TEA_PREVIEW_SECRET: string;
  TEA_EDITOR_ORIGIN?: string;
};

export type EdgeConfig = {
  siteName: string;
  collections: readonly Collection[];
  adminLinks?:
    | readonly { href: string; label: string }[]
    | ((
        request: Request,
      ) => Promise<readonly { href: string; label: string }[]>);
  entryHistory?: boolean;
  previewUrl?: (collection: string, slug: string, token: string) => string;
  afterPublish?: (entry: Entry, env: Bindings) => Promise<void>;
  auth?: {
    loginPath: string;
    authorize: (request: Request) => Promise<"allow" | "login" | "forbidden">;
    logout: (request: Request) => Promise<Response>;
  };
};
