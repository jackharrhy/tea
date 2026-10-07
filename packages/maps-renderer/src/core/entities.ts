import { invalidData } from "./errors.js";

export type EntityValue = string | string[];
export type BspEntity = Record<string, EntityValue>;

class EntityTokenizer {
  private index = 0;

  public constructor(private readonly source: string) {}

  public parse(): BspEntity[] {
    const entities: BspEntity[] = [];
    while (this.peek() !== undefined) {
      this.expect("{");
      const entity: BspEntity = {};
      while (this.peek() !== "}") {
        const key = this.token().toLowerCase();
        const value = this.token();
        const previous = entity[key];
        if (previous === undefined) entity[key] = value;
        else if (Array.isArray(previous)) previous.push(value);
        else entity[key] = [previous, value];
      }
      this.expect("}");
      entities.push(entity);
    }
    return entities;
  }

  private skipIgnored(): void {
    while (this.index < this.source.length) {
      const char = this.source[this.index];
      if (char === undefined) return;
      if (/\s|\0/.test(char)) {
        this.index += 1;
        continue;
      }
      if (char === "/" && this.source[this.index + 1] === "/") {
        this.index += 2;
        while (
          this.index < this.source.length &&
          this.source[this.index] !== "\n"
        )
          this.index += 1;
        continue;
      }
      return;
    }
  }

  private peek(): string | undefined {
    this.skipIgnored();
    return this.source[this.index];
  }

  private expect(expected: string): void {
    const actual = this.peek();
    if (actual !== expected)
      invalidData(
        `expected entity token ${expected}, received ${actual ?? "EOF"}`,
      );
    this.index += 1;
  }

  private token(): string {
    this.skipIgnored();
    const first = this.source[this.index];
    if (first === undefined) invalidData("unexpected end of entity lump");
    if (first === '"') {
      this.index += 1;
      let result = "";
      while (this.index < this.source.length) {
        const char = this.source[this.index++];
        if (char === '"') return result;
        if (char === "\\" && this.source[this.index] === '"') {
          result += '"';
          this.index += 1;
        } else if (char !== undefined) result += char;
      }
      invalidData("unterminated quoted entity token");
    }

    if (first === "{" || first === "}")
      invalidData(`expected entity string, received ${first}`);
    const start = this.index;
    while (this.index < this.source.length) {
      const char = this.source[this.index];
      if (char === undefined || /\s|[{}\0]/.test(char)) break;
      this.index += 1;
    }
    return this.source.slice(start, this.index);
  }
}

export function parseEntities(source: string): BspEntity[] {
  return new EntityTokenizer(source).parse();
}

export function entityValue(
  entity: BspEntity,
  key: string,
): string | undefined {
  const value = entity[key];
  return Array.isArray(value) ? value[0] : value;
}

export interface WadReference {
  readonly declaredPath: string;
  readonly basename: string;
}

export function wadReferences(entities: readonly BspEntity[]): WadReference[] {
  const seen = new Set<string>();
  const references: WadReference[] = [];
  for (const entity of entities) {
    const classnames = entity.classname;
    const isWorldspawn = Array.isArray(classnames)
      ? classnames.includes("worldspawn")
      : classnames === "worldspawn";
    if (!isWorldspawn) continue;
    const wadValues = entity.wad;
    const values =
      wadValues === undefined
        ? []
        : Array.isArray(wadValues)
          ? wadValues
          : [wadValues];
    for (const value of values) {
      for (const part of value.split(";")) {
        const declaredPath = part.trim().replaceAll("\\", "/");
        if (!declaredPath) continue;
        const basename = declaredPath
          .slice(declaredPath.lastIndexOf("/") + 1)
          .toLowerCase();
        if (!basename || seen.has(basename)) continue;
        seen.add(basename);
        references.push({ declaredPath, basename });
      }
    }
  }
  return references;
}
