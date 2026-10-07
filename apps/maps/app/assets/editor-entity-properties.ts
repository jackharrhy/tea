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

function propertyValue(
  property: EntityPropertyDefinition | undefined,
  entity: MapEntity,
  key: string,
): string {
  return entity.properties[key] ?? property?.defaultValue ?? "";
}

export function renderEntityProperties(options: {
  readonly list: HTMLElement;
  readonly entity: MapEntity;
  readonly definitions: EntityDefinitionCatalog | undefined;
  readonly editable: boolean;
  readonly canProtect: boolean;
  readonly commit: (key: string, value: string | null) => void;
  readonly protect: (key: string, value: boolean) => void;
}): void {
  const { list, entity, definitions, editable, canProtect, commit, protect } =
    options;
  const protectedKeys = new Set(protectedEntityProperties(entity));
  const definition = definitions?.find(entity.properties.classname ?? "");
  const defined = new Map(
    definition?.properties.map((property) => [property.key, property]),
  );
  const keys = new Set([...Object.keys(entity.properties), ...defined.keys()]);
  list.replaceChildren();

  for (const key of keys) {
    if (key.startsWith("_tb_")) continue;
    const property = defined.get(key);
    const value = propertyValue(property, entity, key);
    let currentValue = value;
    const row = document.createElement("div");
    row.className = "entity-property-row";
    const label = document.createElement("label");
    label.textContent = property?.label ?? key;
    label.title = property?.description
      ? `${key}: ${property.description}`
      : key;
    const set = (next: string) => {
      if (next === currentValue && key in entity.properties) return;
      commit(key, next);
      currentValue = next;
    };

    if (property?.type === "choices" && property.choices?.length) {
      const select = document.createElement("select");
      const choices = [...property.choices];
      if (!value) choices.unshift({ value: "", label: "Choose…" });
      if (!choices.some((choice) => choice.value === value) && value) {
        choices.push({ value, label: `Unknown (${value})` });
      }
      select.replaceChildren(
        ...choices.map((choice) => new Option(choice.label, choice.value)),
      );
      select.value = value;
      select.disabled = !editable;
      select.addEventListener("change", () => set(select.value));
      label.append(select);
    } else if (property?.type === "boolean") {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked =
        value !== "0" && value.toLowerCase() !== "false" && value !== "";
      checkbox.disabled = !editable;
      checkbox.addEventListener("change", () =>
        set(checkbox.checked ? "1" : "0"),
      );
      label.prepend(checkbox);
    } else if (property?.type === "flags" && property.choices?.length) {
      const group = document.createElement("span");
      group.className = "entity-property-flags";
      for (const choice of property.choices) {
        const bit = Number(choice.value);
        if (!Number.isInteger(bit) || bit <= 0) continue;
        const choiceLabel = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = ((Number(value) || 0) & bit) === bit;
        checkbox.disabled = !editable;
        checkbox.addEventListener("change", () => {
          const current = Number(currentValue) || 0;
          set(String(checkbox.checked ? current | bit : current & ~bit));
        });
        choiceLabel.append(checkbox, choice.label);
        group.append(choiceLabel);
      }
      row.append(label, group);
    } else {
      const input = document.createElement("input");
      input.type =
        property?.type === "integer" ||
        property?.type === "float" ||
        property?.type === "angle"
          ? "number"
          : "text";
      if (input.type === "number") {
        input.step = property?.type === "integer" ? "1" : "any";
      }
      input.value = value;
      input.placeholder = property?.defaultValue ?? "";
      input.disabled = !editable;
      input.addEventListener("change", () => set(input.value));
      label.append(input);
    }

    if (!row.contains(label)) row.prepend(label);
    if (canProtect) {
      const protection = document.createElement("label");
      protection.className = "entity-property-protection";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = protectedKeys.has(key);
      checkbox.disabled = !editable;
      checkbox.setAttribute(
        "aria-label",
        `Keep ${key} independent in this linked copy`,
      );
      checkbox.addEventListener("change", () => protect(key, checkbox.checked));
      protection.append(checkbox, document.createTextNode("Independent"));
      row.append(protection);
    }
    if (key !== "classname" && key in entity.properties) {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", `Remove ${key}`);
      remove.disabled = !editable;
      remove.addEventListener("click", () => commit(key, null));
      row.append(remove);
    }
    list.append(row);
  }
}
