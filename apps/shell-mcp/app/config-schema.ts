import * as s from "remix/data-schema";
import * as coerce from "remix/data-schema/coerce";

const requiredText = s
  .string()
  .refine((value) => value.trim().length > 0, "Value is required");
const commaSeparated = requiredText
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  )
  .refine((values) => values.length > 0, "At least one value is required");
const exactOrigin = s.string().refine((value) => {
  const url = URL.parse(value);
  return (
    url !== null &&
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.origin === value
  );
}, "Expected an exact HTTP(S) origin");
export const publicOriginSchema = s.object({ PUBLIC_ORIGIN: exactOrigin });
const httpsOrigin = exactOrigin.refine(
  (value) => value.startsWith("https://"),
  "Expected an HTTPS origin",
);
const httpsUrl = s.string().refine((value) => {
  const url = URL.parse(value);
  return (
    url !== null &&
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    url.href === value
  );
}, "Expected an exact HTTPS URL");

export const commonEnv = s.object({
  SHELL_MODE: s.defaulted(s.enum_(["locked", "demo", "fourorm"]), "locked"),
  SHELL_RUNNER: s.defaulted(s.enum_(["disabled", "systemd"]), "disabled"),
  HOST: s.defaulted(requiredText, "127.0.0.1"),
  PORT: s.defaulted(
    coerce
      .number()
      .refine(
        (port) => Number.isSafeInteger(port) && port >= 0 && port <= 65535,
        "Invalid PORT",
      ),
    3000,
  ),
  PUBLIC_ORIGIN: s.optional(exactOrigin),
  SHELL_MCP_NAME: s.defaulted(requiredText, "shell-mcp"),
  SHELL_MCP_TITLE: s.defaulted(requiredText, "Shell MCP"),
});

export const liveEnv = s.object({
  FOURORM_ISSUER: httpsOrigin,
  SHELL_AUTHORIZATION_SERVER: httpsUrl,
  SHELL_REQUIRED_SCOPE: requiredText,
  SHELL_ALLOWED_SUBJECTS: commaSeparated,
  SHELL_ALLOWED_USERNAMES: commaSeparated,
  FOURORM_INTROSPECTION_CLIENT_ID: requiredText,
  FOURORM_INTROSPECTION_SECRET_FILE: requiredText,
});

export const systemdEnv = s.object({
  SHELL_JOURNAL_FILE: requiredText.refine(
    (path) => path.startsWith("/"),
    "Journal path must be absolute",
  ),
  SHELL_HELPER_PATH: requiredText.refine(
    (path) => path.startsWith("/") && !path.includes("\0"),
    "Helper path must be absolute and NUL-free",
  ),
});

export function parseEnvironment<Output>(
  schema: s.Schema<unknown, Output>,
  env: NodeJS.ProcessEnv,
): Output {
  const result = s.parseSafe(schema, env);
  if (result.success) return result.value;
  const issue = result.issues[0];
  const field = issue.path?.[0];
  const name = typeof field === "object" ? field.key : field;
  throw new Error(
    `Invalid ${String(name ?? "configuration")}: ${issue.message}`,
  );
}
