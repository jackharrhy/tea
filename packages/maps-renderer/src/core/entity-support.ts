import { entityValue } from "./entities.js";
import type { BspEntity } from "./entities.js";
import type { ParsedModel, ParsedWorld } from "./types.js";

export type EntitySupportKind = "supported" | "partial" | "baked" | "skipped";

export interface EntityClassSupport {
  readonly classname: string;
  readonly count: number;
  readonly kind: EntitySupportKind;
  readonly reason: string;
}

export interface EntitySupportReport {
  readonly total: number;
  readonly counts: Readonly<Record<EntitySupportKind, number>>;
  readonly classes: readonly EntityClassSupport[];
}

type SupportModel = Pick<ParsedModel, "collidable" | "entityIndex" | "visible">;
type SupportWorld = Pick<ParsedWorld, "entities"> & {
  readonly models: readonly SupportModel[];
};

const supportedPointClasses = new Map<string, string>([
  ["env_glow", "sprite rendering"],
  ["env_sound", "room audio"],
  ["env_sprite", "sprite rendering"],
  ["info_player_coop", "camera spawn"],
  ["info_player_counterterrorist", "camera spawn"],
  ["info_player_deathmatch", "camera spawn"],
  ["info_player_start", "camera spawn"],
  ["info_player_terrorist", "camera spawn"],
  ["worldspawn", "world geometry and settings"],
]);

const partiallySupportedPointClasses = new Map<string, string>([
  ["ambient_generic", "map-start audio; entity triggers are not simulated"],
  [
    "ambient_music",
    "global music with manual controls; entity triggers are not simulated",
  ],
]);

const fullySupportedBrushClasses = new Set(["func_detail", "func_wall"]);

const supportPriority: Readonly<Record<EntitySupportKind, number>> = {
  supported: 0,
  baked: 1,
  partial: 2,
  skipped: 3,
};

function supportForEntity(
  entity: BspEntity,
  entityIndex: number,
  models: ReadonlyMap<number, SupportModel>,
): Omit<EntityClassSupport, "count" | "classname"> & { classname: string } {
  const classname =
    entityValue(entity, "classname")?.trim().toLowerCase() ||
    "(missing classname)";
  const supportedReason = supportedPointClasses.get(classname);
  if (supportedReason)
    return { classname, kind: "supported", reason: supportedReason };

  const partialReason = partiallySupportedPointClasses.get(classname);
  if (partialReason)
    return { classname, kind: "partial", reason: partialReason };

  if (classname.startsWith("light") || classname === "info_texlights") {
    return {
      classname,
      kind: "baked",
      reason: "effect is compiled into the BSP lightmaps",
    };
  }

  const model = models.get(entityIndex);
  if (!model) {
    return { classname, kind: "skipped", reason: "no static exhibit behavior" };
  }
  if (!model.visible) {
    return {
      classname,
      kind: "skipped",
      reason: "brush entity requires gameplay state",
    };
  }
  if (fullySupportedBrushClasses.has(classname)) {
    return {
      classname,
      kind: "supported",
      reason: "static brush rendering and collision",
    };
  }
  if (model.collidable) {
    return {
      classname,
      kind: "partial",
      reason:
        "static brush rendering and collision; entity behavior is not simulated",
    };
  }
  return {
    classname,
    kind: "partial",
    reason: "static brush geometry renders; entity behavior is not simulated",
  };
}

export function analyzeEntitySupport(world: SupportWorld): EntitySupportReport {
  const models = new Map<number, SupportModel>();
  for (const model of world.models) {
    if (model.entityIndex !== null) models.set(model.entityIndex, model);
  }

  const counts: Record<EntitySupportKind, number> = {
    supported: 0,
    partial: 0,
    baked: 0,
    skipped: 0,
  };
  const classes = new Map<string, EntityClassSupport>();
  world.entities.forEach((entity, entityIndex) => {
    const support = supportForEntity(entity, entityIndex, models);
    counts[support.kind] += 1;
    const previous = classes.get(support.classname);
    if (!previous) {
      classes.set(support.classname, { ...support, count: 1 });
      return;
    }
    const useCurrent =
      supportPriority[support.kind] > supportPriority[previous.kind];
    classes.set(support.classname, {
      classname: support.classname,
      count: previous.count + 1,
      kind: useCurrent ? support.kind : previous.kind,
      reason: useCurrent ? support.reason : previous.reason,
    });
  });

  return {
    total: world.entities.length,
    counts,
    classes: [...classes.values()].toSorted(
      (left, right) =>
        supportPriority[right.kind] - supportPriority[left.kind] ||
        right.count - left.count ||
        left.classname.localeCompare(right.classname),
    ),
  };
}
