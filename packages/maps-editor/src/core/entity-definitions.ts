import type { Bounds, Vec3 } from "./types.js";
import type { EntityDefinitionFormat } from "./maps-project.js";

export type EntityPropertyType =
  | "string"
  | "integer"
  | "float"
  | "boolean"
  | "color"
  | "vector"
  | "angle"
  | "angles"
  | "target"
  | "targetname"
  | "resource"
  | "choices"
  | "flags";

export interface EntityPropertyChoice {
  readonly value: string;
  readonly label: string;
  readonly default?: boolean;
}

export interface EntityPropertyDefinition {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly type: EntityPropertyType;
  readonly defaultValue?: string;
  readonly choices?: readonly EntityPropertyChoice[];
}

export interface EntityDefinition {
  readonly classname: string;
  readonly kind: "base" | "point" | "brush";
  readonly label: string;
  readonly description?: string;
  readonly bases: readonly string[];
  readonly bounds?: Bounds;
  readonly color?: readonly [number, number, number];
  readonly sprite?: string;
  readonly model?: string;
  readonly properties: readonly EntityPropertyDefinition[];
  readonly sourcePath?: string;
}

export interface EntityDefinitionDiagnostic {
  readonly severity: "warning" | "error";
  readonly message: string;
  readonly sourcePath?: string;
  readonly line?: number;
}

export interface ParsedEntityDefinitionFile {
  readonly definitions: readonly EntityDefinition[];
  readonly includes: readonly string[];
  readonly diagnostics: readonly EntityDefinitionDiagnostic[];
}

function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

function numberList(value: string | undefined): number[] {
  return value?.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)/g)?.map(Number) ?? [];
}

function vec3(values: readonly number[], offset = 0): Vec3 | undefined {
  return values.length >= offset + 3
    ? [values[offset]!, values[offset + 1]!, values[offset + 2]!]
    : undefined;
}

function boundsFromNumbers(values: readonly number[]): Bounds | undefined {
  const min = vec3(values);
  const max = vec3(values, 3);
  return min && max ? { min, max } : undefined;
}

function colorFromNumbers(
  values: readonly number[],
  unitRange = false,
): [number, number, number] | undefined {
  const color = vec3(values);
  if (!color) return undefined;
  return color.map((value) =>
    Math.max(0, Math.min(255, Math.round(unitRange ? value * 255 : value))),
  ) as [number, number, number];
}

function normalizePropertyType(type: string, key: string): EntityPropertyType {
  const normalized = type.trim().toLowerCase();
  if (normalized === "flags" || normalized === "choices") return normalized;
  if (normalized.includes("target_source") || normalized === "targetname")
    return "targetname";
  if (normalized.includes("target_destination") || normalized === "target")
    return "target";
  if (normalized.includes("angle") && normalized !== "angles") return "angle";
  if (normalized === "angles") return "angles";
  if (normalized.includes("color")) return "color";
  if (normalized.includes("vector") || normalized === "origin") return "vector";
  if (normalized.includes("integer") || normalized === "int") return "integer";
  if (
    normalized.includes("float") ||
    normalized === "real" ||
    normalized === "decimal"
  )
    return "float";
  if (normalized.includes("boolean") || normalized === "bool") return "boolean";
  if (
    normalized.includes("sound") ||
    normalized.includes("sprite") ||
    normalized.includes("studio")
  ) {
    return "resource";
  }
  if (key.toLowerCase() === "target") return "target";
  if (key.toLowerCase() === "targetname") return "targetname";
  return "string";
}

function unquote(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  return trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1).replaceAll('\\"', '"')
    : trimmed;
}

function parseFgdChoices(body: string): readonly EntityPropertyChoice[] {
  const choices: EntityPropertyChoice[] = [];
  const pattern =
    /(?:^|\r?\n)\s*("[^"]*"|[^\s:]+)\s*:\s*"([^"]*)"(?:\s*:\s*([01]))?/g;
  for (const match of body.matchAll(pattern)) {
    const choice: EntityPropertyChoice = {
      value: unquote(match[1]) ?? "",
      label: match[2] ?? "",
    };
    choices.push(
      match[3] === undefined
        ? choice
        : {
            value: choice.value,
            label: choice.label,
            default: match[3] === "1",
          },
    );
  }
  return choices;
}

function parseFgdProperties(body: string): readonly EntityPropertyDefinition[] {
  const starts = [
    ...body.matchAll(/(?:^|\r?\n)\s*([\w.$-]+)\s*\(([^)]*)\)\s*(?::|=)/g),
  ];
  return starts.map((match, index) => {
    const key = match[1]!;
    const type = normalizePropertyType(match[2] ?? "", key);
    const start = match.index! + match[0].length;
    const end = starts[index + 1]?.index ?? body.length;
    const tail = body.slice(start, end).trim();
    const label = /^"([^"]*)"/.exec(tail)?.[1] ?? key;
    const headerTail = tail
      .replace(/\[[\s\S]*$/, "")
      .replace(/=\s*$/, "")
      .trim();
    const colonParts = headerTail.split(/\s*:\s*/);
    const defaultValue = unquote(colonParts[1]);
    const choiceBlock = /\[([\s\S]*?)\]/.exec(tail)?.[1] ?? "";
    const choices =
      type === "choices" || type === "flags"
        ? parseFgdChoices(choiceBlock)
        : [];
    if (defaultValue === undefined && choices.length === 0)
      return { key, label, type };
    if (defaultValue === undefined) return { key, label, type, choices };
    if (choices.length === 0) return { key, label, type, defaultValue };
    return { key, label, type, defaultValue, choices };
  });
}

function matchingBracket(
  source: string,
  opening: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  let quoted = false;
  for (let index = opening; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === '"' && source[index - 1] !== "\\") quoted = !quoted;
    if (quoted) continue;
    if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function maskComments(source: string): string {
  const masked = [...source];
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === '"' && source[index - 1] !== "\\") {
      quoted = !quoted;
      continue;
    }
    if (quoted || character !== "/") continue;
    const next = source[index + 1];
    if (next === "/") {
      while (index < source.length && source[index] !== "\n") {
        masked[index] = " ";
        index += 1;
      }
      index -= 1;
    } else if (next === "*") {
      masked[index] = " ";
      masked[index + 1] = " ";
      index += 2;
      while (index < source.length) {
        if (source[index] === "*" && source[index + 1] === "/") {
          masked[index] = " ";
          masked[index + 1] = " ";
          index += 1;
          break;
        }
        if (source[index] !== "\n" && source[index] !== "\r")
          masked[index] = " ";
        index += 1;
      }
    }
  }
  return masked.join("");
}

function fgdAttribute(header: string, name: string): string | undefined {
  return new RegExp(`\\b${name}\\s*\\(([^)]*)\\)`, "i").exec(header)?.[1];
}

function parseFgd(
  source: string,
  sourcePath?: string,
): ParsedEntityDefinitionFile {
  const definitions: EntityDefinition[] = [];
  const diagnostics: EntityDefinitionDiagnostic[] = [];
  const parseableSource = maskComments(source);
  const includes = [...parseableSource.matchAll(/@include\s+"([^"]+)"/gi)].map(
    (match) => match[1]!,
  );
  const classPattern =
    /@(BaseClass|PointClass|SolidClass)\b([\s\S]*?)=\s*([\w.$-]+)\s*(?::\s*"([^"]*)")?\s*\[/gi;
  for (
    let match = classPattern.exec(parseableSource);
    match;
    match = classPattern.exec(parseableSource)
  ) {
    const opening = classPattern.lastIndex - 1;
    const closing = matchingBracket(parseableSource, opening, "[", "]");
    if (closing < 0) {
      diagnostics.push({
        severity: "error",
        message: `Unterminated FGD class ${match[3] ?? ""}`,
        line: lineAt(source, opening),
        ...(sourcePath ? { sourcePath } : {}),
      });
      break;
    }
    const header = match[2] ?? "";
    const kindToken = match[1]!.toLowerCase();
    const kind =
      kindToken === "baseclass"
        ? "base"
        : kindToken === "solidclass"
          ? "brush"
          : "point";
    const size = numberList(fgdAttribute(header, "size"));
    const bounds = boundsFromNumbers(size);
    const color = colorFromNumbers(numberList(fgdAttribute(header, "color")));
    const sprite = /\b(?:iconsprite|sprite)\s*\(\s*"([^"]+)"/i.exec(
      header,
    )?.[1];
    const model = /\b(?:studio|model)\s*\(\s*"([^"]+)"/i.exec(header)?.[1];
    const bases =
      fgdAttribute(header, "base")
        ?.split(",")
        .map((value) => value.trim())
        .filter(Boolean) ?? [];
    definitions.push({
      classname: match[3]!,
      kind,
      label: match[4] || match[3]!,
      bases,
      ...(bounds ? { bounds } : {}),
      ...(color ? { color } : {}),
      ...(sprite ? { sprite } : {}),
      ...(model ? { model } : {}),
      properties: parseFgdProperties(
        parseableSource.slice(opening + 1, closing),
      ),
      ...(sourcePath ? { sourcePath } : {}),
    });
    classPattern.lastIndex = closing + 1;
  }
  const classTokens = [
    ...parseableSource.matchAll(/@(BaseClass|PointClass|SolidClass)\b/gi),
  ].length;
  if (definitions.length < classTokens) {
    const firstClass = /@(BaseClass|PointClass|SolidClass)\b/i.exec(
      parseableSource,
    );
    diagnostics.push({
      severity: "error",
      message: `Parsed ${definitions.length} of ${classTokens} FGD class declarations`,
      ...(firstClass?.index === undefined
        ? {}
        : { line: lineAt(source, firstClass.index) }),
      ...(sourcePath ? { sourcePath } : {}),
    });
  }
  return { definitions, includes, diagnostics };
}

function parseDef(
  source: string,
  sourcePath?: string,
): ParsedEntityDefinitionFile {
  const definitions: EntityDefinition[] = [];
  const diagnostics: EntityDefinitionDiagnostic[] = [];
  const blockPattern =
    /\/\*QUAKED\s+([\w.$-]+)\s+\(([^)]*)\)\s+([^\r\n]*)([\s\S]*?)\*\//gi;
  for (const match of source.matchAll(blockPattern)) {
    const declaration = match[3]?.trim() ?? "";
    const boundsParts = [...declaration.matchAll(/\(([^)]*)\)/g)];
    const isBrush = declaration.startsWith("?");
    const bounds =
      boundsParts.length >= 2
        ? boundsFromNumbers([
            ...numberList(boundsParts[0]?.[1]),
            ...numberList(boundsParts[1]?.[1]),
          ])
        : undefined;
    const flagTail = declaration
      .replace(/\([^)]*\)/g, "")
      .replace(/^\?/, "")
      .trim();
    const flags = flagTail
      .split(/\s+/)
      .filter((value) => value && value.toLowerCase() !== "x")
      .map((label, index) => ({ value: String(1 << index), label }));
    const color = colorFromNumbers(numberList(match[2]), true);
    const description = match[4]?.trim();
    definitions.push({
      classname: match[1]!,
      kind: isBrush ? "brush" : "point",
      label: match[1]!,
      ...(description ? { description } : {}),
      bases: [],
      ...(bounds ? { bounds } : {}),
      ...(color ? { color } : {}),
      properties:
        flags.length === 0
          ? []
          : [
              {
                key: "spawnflags",
                label: "Spawn flags",
                type: "flags",
                choices: flags,
              },
            ],
      ...(sourcePath ? { sourcePath } : {}),
    });
  }
  const declarations = [...source.matchAll(/\/\*QUAKED\b/gi)].length;
  if (definitions.length < declarations) {
    const firstDeclaration = /\/\*QUAKED\b/i.exec(source);
    diagnostics.push({
      severity: "error",
      message: `Parsed ${definitions.length} of ${declarations} QUAKED declarations`,
      ...(firstDeclaration?.index === undefined
        ? {}
        : { line: lineAt(source, firstDeclaration.index) }),
      ...(sourcePath ? { sourcePath } : {}),
    });
  }
  return { definitions, includes: [], diagnostics };
}

function xmlAttributes(source: string): Readonly<Record<string, string>> {
  return Object.fromEntries(
    [...source.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map((match) => [
      match[1]!,
      match[2]!,
    ]),
  );
}

function parseEntProperties(body: string): readonly EntityPropertyDefinition[] {
  const properties: EntityPropertyDefinition[] = [];
  const propertyPattern =
    /<(angle|angles|real|float|integer|boolean|color|vector|string|target|targetname|sound|model|sprite|choices|flags)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const match of body.matchAll(propertyPattern)) {
    const attributes = xmlAttributes(match[2] ?? "");
    const key = attributes.key;
    if (!key) continue;
    const type = normalizePropertyType(match[1] ?? "", key);
    const choices = [
      ...(match[3] ?? "").matchAll(/<item\b([^>]*)\/?>(?:[\s\S]*?<\/item>)?/gi),
    ]
      .map((choice) => xmlAttributes(choice[1] ?? ""))
      .filter((choice) => choice.value !== undefined)
      .map((choice) => ({
        value: choice.value!,
        label: choice.name ?? choice.value!,
      }));
    const description = (match[3] ?? "").replace(/<[^>]+>/g, "").trim();
    properties.push({
      key,
      label: attributes.name ?? key,
      type,
      ...(attributes.value === undefined
        ? {}
        : { defaultValue: attributes.value }),
      ...(description ? { description } : {}),
      ...(choices.length === 0 ? {} : { choices }),
    });
  }
  return properties;
}

function parseEnt(
  source: string,
  sourcePath?: string,
): ParsedEntityDefinitionFile {
  const definitions: EntityDefinition[] = [];
  const diagnostics: EntityDefinitionDiagnostic[] = [];
  const classPattern = /<(point|group)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const match of source.matchAll(classPattern)) {
    const attributes = xmlAttributes(match[2] ?? "");
    if (!attributes.name) {
      diagnostics.push({
        severity: "error",
        message: "ENT class is missing a name",
        line: lineAt(source, match.index ?? 0),
        ...(sourcePath ? { sourcePath } : {}),
      });
      continue;
    }
    const bounds = boundsFromNumbers(numberList(attributes.box));
    const color = colorFromNumbers(numberList(attributes.color), true);
    const description = (match[3] ?? "").replace(/<[^>]+>/g, "").trim();
    definitions.push({
      classname: attributes.name,
      kind: match[1]?.toLowerCase() === "group" ? "brush" : "point",
      label: attributes.name,
      ...(description ? { description } : {}),
      bases: [],
      ...(bounds ? { bounds } : {}),
      ...(color ? { color } : {}),
      ...(attributes.model ? { model: attributes.model } : {}),
      properties: parseEntProperties(match[3] ?? ""),
      ...(sourcePath ? { sourcePath } : {}),
    });
  }
  const classTokens = [...source.matchAll(/<(?:point|group)\b/gi)].length;
  if (definitions.length < classTokens) {
    const firstClass = /<(?:point|group)\b/i.exec(source);
    diagnostics.push({
      severity: "error",
      message: `Parsed ${definitions.length} of ${classTokens} ENT class declarations`,
      ...(firstClass?.index === undefined
        ? {}
        : { line: lineAt(source, firstClass.index) }),
      ...(sourcePath ? { sourcePath } : {}),
    });
  }
  return { definitions, includes: [], diagnostics };
}

export function parseEntityDefinitionFile(
  format: EntityDefinitionFormat,
  source: string,
  sourcePath?: string,
): ParsedEntityDefinitionFile {
  if (format === "fgd") return parseFgd(source, sourcePath);
  if (format === "def") return parseDef(source, sourcePath);
  return parseEnt(source, sourcePath);
}

export class EntityDefinitionCatalog {
  private readonly definitions = new Map<string, EntityDefinition>();

  public constructor(files: readonly ParsedEntityDefinitionFile[] = []) {
    for (const file of files) this.add(file.definitions);
  }

  public add(definitions: readonly EntityDefinition[]): void {
    for (const definition of definitions) {
      this.definitions.set(definition.classname.toLowerCase(), definition);
    }
  }

  public get size(): number {
    return this.definitions.size;
  }

  public all(): readonly EntityDefinition[] {
    return [...this.definitions.values()]
      .filter(({ kind }) => kind !== "base")
      .map((definition) => this.resolve(definition))
      .toSorted((left, right) => left.classname.localeCompare(right.classname));
  }

  public find(classname: string): EntityDefinition | undefined {
    const definition = this.definitions.get(classname.trim().toLowerCase());
    return definition ? this.resolve(definition) : undefined;
  }

  private resolve(
    definition: EntityDefinition,
    resolving = new Set<string>(),
  ): EntityDefinition {
    const key = definition.classname.toLowerCase();
    if (resolving.has(key)) return definition;
    const nextResolving = new Set(resolving).add(key);
    const bases = definition.bases
      .map((base) => this.definitions.get(base.toLowerCase()))
      .filter((base): base is EntityDefinition => Boolean(base))
      .map((base) => this.resolve(base, nextResolving));
    const inheritedProperties = new Map<string, EntityPropertyDefinition>();
    for (const base of bases) {
      for (const property of base.properties)
        inheritedProperties.set(property.key, property);
    }
    for (const property of definition.properties)
      inheritedProperties.set(property.key, property);
    const bounds =
      definition.bounds ?? bases.find((candidate) => candidate.bounds)?.bounds;
    const color =
      definition.color ?? bases.find((candidate) => candidate.color)?.color;
    const sprite =
      definition.sprite ?? bases.find((candidate) => candidate.sprite)?.sprite;
    const model =
      definition.model ?? bases.find((candidate) => candidate.model)?.model;
    return {
      ...definition,
      ...(bounds ? { bounds } : {}),
      ...(color ? { color } : {}),
      ...(sprite ? { sprite } : {}),
      ...(model ? { model } : {}),
      properties: [...inheritedProperties.values()],
    };
  }
}
