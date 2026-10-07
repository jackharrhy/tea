import { MapParseError } from "./map-parser-error.js";
import type { MapFaceSyntax } from "./types.js";

export type MapTokenKind = "string" | "word" | "symbol";

export interface MapToken {
  readonly kind: MapTokenKind;
  readonly value: string;
  readonly line: number;
  readonly column: number;
  readonly start: number;
  readonly end: number;
}

export interface TokenizedMapSource {
  readonly tokens: readonly MapToken[];
  readonly faceSyntaxHint: MapFaceSyntax | null;
}

function faceSyntaxHint(comment: string): MapFaceSyntax | null {
  const format = /^\s*Format\s*:\s*(.+?)\s*$/i
    .exec(comment)?.[1]
    ?.toLowerCase();
  if (!format) return null;
  if (format === "valve" || format === "valve 220" || format === "valve-220")
    return "valve-220";
  if (format === "standard" || format === "quake") return "quake";
  return null;
}

/** Tokenizes Quake-family text while retaining source offsets for structure-preserving saves. */
export function tokenizeMapSource(source: string): TokenizedMapSource {
  const tokens: MapToken[] = [];
  let syntaxHint: MapFaceSyntax | null = null;
  let offset = 0;
  let line = 1;
  let column = 1;
  const advance = () => {
    const character = source[offset++]!;
    if (character === "\n") {
      line += 1;
      column = 1;
    } else column += 1;
    return character;
  };
  while (offset < source.length) {
    const character = source[offset]!;
    if (/\s/.test(character)) {
      advance();
      continue;
    }
    const slashComment = character === "/" && source[offset + 1] === "/";
    if (slashComment || character === ";") {
      if (slashComment) {
        advance();
        advance();
      } else advance();
      let comment = "";
      while (offset < source.length && source[offset] !== "\n")
        comment += advance();
      syntaxHint ??= faceSyntaxHint(comment);
      continue;
    }
    const startLine = line;
    const startColumn = column;
    if (character === '"') {
      const start = offset;
      advance();
      let value = "";
      let closed = false;
      while (offset < source.length) {
        const next = advance();
        if (next === '"') {
          closed = true;
          break;
        }
        if (next === "\\" && offset < source.length) {
          const escaped = advance();
          value += escaped === "n" ? "\n" : escaped;
        } else value += next;
      }
      if (!closed)
        throw new MapParseError(
          "Unterminated quoted string",
          startLine,
          startColumn,
        );
      tokens.push({
        kind: "string",
        value,
        line: startLine,
        column: startColumn,
        start,
        end: offset,
      });
      continue;
    }
    if ("{}()[]".includes(character)) {
      const start = offset;
      tokens.push({
        kind: "symbol",
        value: advance(),
        line: startLine,
        column: startColumn,
        start,
        end: offset,
      });
      continue;
    }
    let value = "";
    while (offset < source.length) {
      const next = source[offset]!;
      if (/\s/.test(next) || '{}()[]"'.includes(next) || next === ";") break;
      if (next === "/" && source[offset + 1] === "/") break;
      value += advance();
    }
    if (value.length > 0) {
      tokens.push({
        kind: "word",
        value,
        line: startLine,
        column: startColumn,
        start: offset - value.length,
        end: offset,
      });
    }
  }
  return { tokens, faceSyntaxHint: syntaxHint };
}
