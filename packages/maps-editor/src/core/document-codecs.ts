import { parseMap, parseMapSource } from "./map-parser.js";
import { planMapSave, rebaseMapSource } from "./map-save.js";
import { serializeMap } from "./map-serializer.js";
import type {
  MapSavePlan,
  MapSourceState,
  ParsedMapSource,
} from "./map-source-types.js";
import type { IdFactory, MapDocument, MapDocumentFormat } from "./types.js";

/** Selected by document format, independently of game profile and face syntax. */
export interface MapDocumentCodec<TSourceState, TParsedSource, TSavePlan> {
  readonly format: MapDocumentFormat;
  readonly extensions: readonly string[];
  parse(source: string, ids?: IdFactory): MapDocument;
  parseSource(source: string, ids?: IdFactory): TParsedSource;
  serialize(document: MapDocument): string;
  planSave(document: MapDocument, state: TSourceState): TSavePlan;
  rebaseSource(document: MapDocument, savedText: string): TSourceState;
}

export type QuakeMapDocumentCodec = MapDocumentCodec<
  MapSourceState,
  ParsedMapSource,
  MapSavePlan
>;

export const QUAKE_MAP_DOCUMENT_CODEC: QuakeMapDocumentCodec = {
  format: "quake-map",
  extensions: [".map"],
  parse: parseMap,
  parseSource: parseMapSource,
  serialize: serializeMap,
  planSave: planMapSave,
  rebaseSource: rebaseMapSource,
};

type DocumentCodecRegistry = {
  readonly [Format in MapDocumentFormat]: MapDocumentCodec<
    unknown,
    unknown,
    unknown
  > & {
    readonly format: Format;
  };
};

const DOCUMENT_CODECS = {
  "quake-map": QUAKE_MAP_DOCUMENT_CODEC,
} satisfies DocumentCodecRegistry;

export function documentCodecForFormat(
  format: "quake-map",
): QuakeMapDocumentCodec;
export function documentCodecForFormat(
  format: MapDocumentFormat,
): DocumentCodecRegistry[typeof format];
export function documentCodecForFormat(format: MapDocumentFormat) {
  return DOCUMENT_CODECS[format];
}
