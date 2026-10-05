/**
 * Schema builders that validate like remix/data-schema and describe themselves as JSON
 * Schema 2020-12, so the schema a handler validates with is the schema an API publishes.
 * Import as a namespace: `import * as s from "@tea/json-schema"`.
 */

export type { ToJSONSchemaOptions } from "./convert.ts";
export type { ObjectInput, ObjectOptions, ObjectOutput } from "./schema.ts";
export type {
  Annotations,
  Check,
  DescribedSchema,
  JSONSchema,
  Schema,
} from "./types.ts";
export type { InferInput, InferOutput } from "remix/data-schema";

export { toJSONSchema, withJSONSchema } from "./convert.ts";
export { JSONSchemaConversionError } from "./error.ts";
export {
  any,
  array,
  boolean,
  defaulted,
  enum_,
  integer,
  lazy,
  literal,
  null_,
  nullable,
  number,
  object,
  optional,
  record,
  string,
  tuple,
  union,
  variant,
} from "./schema.ts";
export { parse, parseSafe, ValidationError } from "remix/data-schema";
