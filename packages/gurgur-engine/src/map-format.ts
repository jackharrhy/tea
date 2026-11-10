import type { Vec3 } from "./types";

export type MapFace = {
  points: [Vec3, Vec3, Vec3];
  material: string;
  uAxis: [number, number, number, number];
  vAxis: [number, number, number, number];
  rotation: number;
  scale: [number, number];
  line: number;
  column: number;
  faceIndex: number;
};

export type MapBrush = {
  faces: MapFace[];
  line: number;
  column: number;
  brushIndex: number;
};
export type MapEntity = {
  properties: Record<string, string>;
  brushes: MapBrush[];
  line: number;
  column: number;
  entityIndex: number;
};
export type ValveMap = { entities: MapEntity[]; sourceName: string };

const NUMBER = "([-+\\d.eE]+)";
const POINT = `\\(\\s*${NUMBER}\\s+${NUMBER}\\s+${NUMBER}\\s*\\)`;
const AXIS = `\\[\\s*${NUMBER}\\s+${NUMBER}\\s+${NUMBER}\\s+${NUMBER}\\s*\\]`;
const FACE_PATTERN = new RegExp(
  `^${POINT}\\s+${POINT}\\s+${POINT}\\s+(\\S+)\\s+${AXIS}\\s+${AXIS}\\s+${NUMBER}\\s+${NUMBER}\\s+${NUMBER}$`,
);

function finite(values: string[], sourceName: string, line: number): number[] {
  const numbers = values.map(Number);
  if (!numbers.every(Number.isFinite))
    throw new Error(`${sourceName}:${line}: non-finite number`);
  return numbers;
}

function parseFace(
  text: string,
  sourceName: string,
  line: number,
  column: number,
  faceIndex: number,
): MapFace {
  const match = FACE_PATTERN.exec(text);
  if (!match)
    throw new Error(
      `${sourceName}:${line}:${column}: face ${faceIndex}: expected a Valve 220 face`,
    );
  const values = finite(match.slice(1, 10), sourceName, line);
  const u = finite(match.slice(11, 15), sourceName, line);
  const v = finite(match.slice(15, 19), sourceName, line);
  const tail = finite(match.slice(19, 22), sourceName, line);
  return {
    points: [
      { x: values[0]!, y: values[1]!, z: values[2]! },
      { x: values[3]!, y: values[4]!, z: values[5]! },
      { x: values[6]!, y: values[7]!, z: values[8]! },
    ],
    material: match[10]!,
    uAxis: [u[0]!, u[1]!, u[2]!, u[3]!],
    vAxis: [v[0]!, v[1]!, v[2]!, v[3]!],
    rotation: tail[0]!,
    scale: [tail[1]!, tail[2]!],
    line,
    column,
    faceIndex,
  };
}

export function parseValve220(source: string, sourceName = "<map>"): ValveMap {
  const entities: MapEntity[] = [];
  let entity: MapEntity | null = null;
  let brush: MapBrush | null = null;
  let depth = 0;
  for (const [index, raw] of source.split(/\r?\n/).entries()) {
    const lineNumber = index + 1;
    const uncommented = stripComment(raw);
    const line = uncommented.trim();
    const column = Math.max(1, uncommented.search(/\S/) + 1);
    if (!line || line.startsWith("//")) continue;
    if (line === "{") {
      if (depth === 0)
        entity = {
          properties: {},
          brushes: [],
          line: lineNumber,
          column,
          entityIndex: entities.length,
        };
      else if (depth === 1)
        brush = {
          faces: [],
          line: lineNumber,
          column,
          brushIndex: entity?.brushes.length ?? 0,
        };
      else
        throw new Error(
          `${sourceName}:${lineNumber}:${column}: entity ${entity?.entityIndex ?? -1}: brushes cannot be nested`,
        );
      depth += 1;
      continue;
    }
    if (line === "}") {
      if (depth === 2) {
        if (!brush || !entity || brush.faces.length < 4) {
          const location = `${sourceName}:${lineNumber}:${column}`;
          throw new Error(
            `${location}: entity ${entity?.entityIndex ?? -1}, ` +
              `brush ${brush?.brushIndex ?? -1}: brush requires at least four faces`,
          );
        }
        entity.brushes.push(brush);
        brush = null;
      } else if (depth === 1) {
        if (!entity)
          throw new Error(
            `${sourceName}:${lineNumber}:${column}: entity is missing`,
          );
        entities.push(entity);
        entity = null;
      } else {
        throw new Error(
          `${sourceName}:${lineNumber}:${column}: unexpected closing brace`,
        );
      }
      depth -= 1;
      continue;
    }
    if (depth === 1 && entity) {
      const property = parseProperty(line);
      if (!property)
        throw new Error(
          `${sourceName}:${lineNumber}:${column}: entity ${entity.entityIndex}: malformed entity property`,
        );
      if (property[0] in entity.properties)
        throw new Error(
          `${sourceName}:${lineNumber}:${column}: entity ${entity.entityIndex}: duplicate property ${property[0]}`,
        );
      entity.properties[property[0]] = property[1];
    } else if (depth === 2 && brush) {
      brush.faces.push(
        parseFace(line, sourceName, lineNumber, column, brush.faces.length),
      );
    } else {
      throw new Error(
        `${sourceName}:${lineNumber}:${column}: content outside an entity or brush`,
      );
    }
  }
  if (depth !== 0 || entity || brush)
    throw new Error(`${sourceName}: unclosed map structure`);
  return { entities, sourceName };
}

function stripComment(line: string): string {
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < line.length - 1; index += 1) {
    const character = line[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quoted) {
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && character === "/" && line[index + 1] === "/")
      return line.slice(0, index);
  }
  return line;
}

function parseProperty(line: string): [string, string] | null {
  const match = /^"((?:\\.|[^"\\])*)"\s+"((?:\\.|[^"\\])*)"$/.exec(line);
  if (!match) return null;
  return [unescapeQuoted(match[1]!), unescapeQuoted(match[2]!)];
}

function unescapeQuoted(value: string): string {
  return value.replace(/\\([\\"])/g, "$1");
}
