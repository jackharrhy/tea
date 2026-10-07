import type {
  EntityDefinitionCatalog,
  EntityPropertyDefinition,
  MapEntity,
} from "@tea/maps-editor/core";
import {
  deriveEditorGroups,
  linkedGroupSiblings,
  protectedEntityProperties,
  type MapDocument,
} from "@tea/maps-editor/core";

export function canProtectEntityProperties(
  document: MapDocument,
  entity: MapEntity,
  openGroupId: string | null,
): boolean {
  const groups = deriveEditorGroups(document);
  const openGroup = groups.find((group) => group.id === openGroupId);
  if (
    !openGroup?.linkedGroupId ||
    linkedGroupSiblings(document, openGroup.id).length < 2
  )
    return false;
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  let containingGroup = groupsById.get(entity.properties["_tb_group"] ?? "");
  while (containingGroup) {
    if (containingGroup.id === openGroup.id) return true;
    containingGroup = groupsById.get(containingGroup.parentGroupId ?? "");
  }
  return false;
}

export interface EntityPropertyRow {
  readonly key: string;
  readonly label: string;
  readonly title: string;
  readonly value: string;
  readonly type: EntityPropertyDefinition["type"] | undefined;
  readonly defaultValue: string;
  readonly choices: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly protected: boolean;
  readonly removable: boolean;
}

export function entityPropertyRows(
  entity: MapEntity,
  definitions: EntityDefinitionCatalog | undefined,
): readonly EntityPropertyRow[] {
  const protectedKeys = new Set(protectedEntityProperties(entity));
  const definition = definitions?.find(entity.properties.classname ?? "");
  const defined = new Map(
    definition?.properties.map((property) => [property.key, property]),
  );
  const keys = new Set([...Object.keys(entity.properties), ...defined.keys()]);
  return [...keys].flatMap((key) => {
    if (key.startsWith("_tb_")) return [];
    const property = defined.get(key);
    const value = entity.properties[key] ?? property?.defaultValue ?? "";
    const choices = [...(property?.choices ?? [])];
    if (property?.type === "choices" && choices.length) {
      if (!value) choices.unshift({ value: "", label: "Choose…" });
      if (value && !choices.some((choice) => choice.value === value)) {
        choices.push({ value, label: `Unknown (${value})` });
      }
    }
    return [
      {
        key,
        label: property?.label ?? key,
        title: property?.description ? `${key}: ${property.description}` : key,
        value,
        type: property?.type,
        defaultValue: property?.defaultValue ?? "",
        choices,
        protected: protectedKeys.has(key),
        removable: key !== "classname" && key in entity.properties,
      },
    ];
  });
}
