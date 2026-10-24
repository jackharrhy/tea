import { z } from "zod";

import {
  MapsGameProfileSchema,
  mapsGameProfile,
  type MapsGameProfile,
} from "./game-profiles.js";

export type { MapsGameProfile } from "./game-profiles.js";
export type EntityDefinitionFormat = "fgd" | "def" | "ent";

export interface MapsEntityDefinitionSource {
  readonly path: string;
  readonly format: EntityDefinitionFormat;
}

export interface MapsProjectResources {
  /** Later entries override earlier WAD entries with the same logical texture name. */
  readonly wads: readonly string[];
  /** Ordered game-directory roots for profile-native assets; later roots override earlier ones. */
  readonly gameRoots?: readonly string[] | undefined;
  readonly palette?: string | undefined;
  readonly spriteRoots: readonly string[];
  readonly entityDefinitions: readonly MapsEntityDefinitionSource[];
}

export interface MapsProjectBuildProfile {
  readonly id: string;
  readonly label: string;
  readonly quality: "preview" | "final";
}

export interface MapsProjectManifest {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly game: MapsGameProfile;
  readonly mapRoots: readonly string[];
  readonly resources: MapsProjectResources;
  readonly buildProfiles: readonly MapsProjectBuildProfile[];
  readonly defaultBuildProfile?: string | undefined;
  readonly hosted?:
    | {
        readonly origin: string;
        readonly projectId: string;
        readonly maps: readonly {
          readonly path: string;
          readonly mapId: string;
        }[];
      }
    | undefined;
}

export class MapsProjectParseError extends Error {
  public constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(field ? `${field}: ${message}` : message);
    this.name = "MapsProjectParseError";
  }
}

const nonEmptyString = z
  .string({ error: "must be a non-empty string" })
  .trim()
  .min(1, { error: "must be a non-empty string" });

function relativePathSchema(allowRoot = false) {
  return nonEmptyString
    .refine(
      (path) =>
        !path.includes("\\") &&
        !path.startsWith("/") &&
        !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path) &&
        !path.split("/").some((part) => part === ".." || part === "") &&
        (allowRoot || path !== "."),
      { error: "must be a contained project-relative POSIX path" },
    )
    .transform((path) => path.replace(/^\.\//, ""));
}

function uniquePaths(allowRoot = false) {
  return z
    .array(relativePathSchema(allowRoot), { error: "must be an array" })
    .refine((values) => new Set(values).size === values.length, {
      error: "must not contain duplicates",
    });
}

const EntityDefinitionSourceSchema = z.strictObject({
  path: relativePathSchema(),
  format: z.enum(["fgd", "def", "ent"], { error: "must be fgd, def, or ent" }),
});

const ProjectResourcesSchema = z.strictObject({
  wads: uniquePaths().default([]),
  gameRoots: uniquePaths(true).optional(),
  palette: relativePathSchema().optional(),
  spriteRoots: uniquePaths(true).default([]),
  entityDefinitions: z
    .array(EntityDefinitionSourceSchema, { error: "must be an array" })
    .default([]),
});

const BuildProfileSchema = z.strictObject({
  id: nonEmptyString,
  label: nonEmptyString,
  quality: z.enum(["preview", "final"], { error: "must be preview or final" }),
});

const HostedProjectLinkSchema = z
  .strictObject({
    origin: z
      .url()
      .refine(
        (value) => new URL(value).origin === value,
        "must be an origin without a path",
      ),
    projectId: z.string().regex(/^[a-z0-9]{12}$/),
    maps: z
      .array(
        z.strictObject({
          path: relativePathSchema(),
          mapId: z.string().regex(/^[a-z0-9]{12}$/),
        }),
      )
      .max(10_000),
  })
  .superRefine((link, context) => {
    for (const field of ["path", "mapId"] as const) {
      const values = link.maps.map((map) => map[field]);
      if (new Set(values).size !== values.length)
        context.addIssue({
          code: "custom",
          path: ["maps"],
          message: `hosted maps must have unique ${field} values`,
        });
    }
  });

const ProjectManifestObjectSchema = z
  .strictObject({
    schemaVersion: z.literal(1, { error: "only schemaVersion 1 is supported" }),
    name: nonEmptyString,
    game: MapsGameProfileSchema,
    mapRoots: uniquePaths(true).min(1, {
      error: "must contain at least one map root",
    }),
    resources: ProjectResourcesSchema,
    buildProfiles: z
      .array(BuildProfileSchema, { error: "must be an array" })
      .default([]),
    defaultBuildProfile: nonEmptyString.optional(),
    hosted: HostedProjectLinkSchema.optional(),
  })
  .superRefine((project, context) => {
    const ids = project.buildProfiles.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["buildProfiles"],
        message: "buildProfiles[].id must not contain duplicates",
      });
    }
    if (
      project.defaultBuildProfile !== undefined &&
      !project.buildProfiles.some(
        ({ id }) => id === project.defaultBuildProfile,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["defaultBuildProfile"],
        message: "must reference an existing build profile",
      });
    }
    const supportedFormats = mapsGameProfile(
      project.game,
    ).entityDefinitionFormats;
    for (const [
      index,
      definition,
    ] of project.resources.entityDefinitions.entries()) {
      if (!supportedFormats.includes(definition.format)) {
        context.addIssue({
          code: "custom",
          path: ["resources", "entityDefinitions", index, "format"],
          message: `${definition.format} is not supported by the ${project.game} profile`,
        });
      }
    }
    if (project.hosted) {
      for (const key of ["path", "mapId"] as const) {
        const values = project.hosted.maps.map((map) => map[key].toLowerCase());
        if (new Set(values).size !== values.length) {
          context.addIssue({
            code: "custom",
            path: ["hosted", "maps"],
            message: `hosted map ${key}s must be unique`,
          });
        }
      }
    }
  });

/** Strict canonical schema for a `tea.maps.project.json` manifest. */
export const MapsProjectManifestSchema =
  ProjectManifestObjectSchema satisfies z.ZodType<MapsProjectManifest>;

function fieldForIssue(issue: z.core.$ZodIssue): string {
  const path = [...issue.path];
  if (issue.code === "unrecognized_keys" && issue.keys[0])
    path.push(issue.keys[0]);
  if (path.length === 0) return "project";
  return path
    .map((part, index) =>
      typeof part === "number"
        ? `[${part}]`
        : `${index > 0 ? "." : ""}${String(part)}`,
    )
    .join("")
    .replace(/\.\[/g, "[");
}

function messageForIssue(issue: z.core.$ZodIssue): string {
  if (issue.code === "unrecognized_keys")
    return "is not a recognized project field";
  if (issue.message.startsWith("buildProfiles[].id: ")) {
    return issue.message.slice("buildProfiles[].id: ".length);
  }
  return issue.message;
}

export function parseMapsProject(source: string): MapsProjectManifest {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new MapsProjectParseError(
      `contains invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const result = MapsProjectManifestSchema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    throw new MapsProjectParseError(
      messageForIssue(issue),
      fieldForIssue(issue),
    );
  }
  return result.data;
}

export function serializeMapsProject(project: MapsProjectManifest): string {
  const validated = parseMapsProject(JSON.stringify(project));
  return `${JSON.stringify(validated, null, 2)}\n`;
}
