import { BinaryView } from "./binary.js";
import { identifyBsp, type BspIdentification } from "./bsp-identification.js";
import { invalidData, invariant, WorldviewError } from "./errors.js";
import {
  BSP2_2PSB_MAGIC,
  quakeBspLayout,
  type QuakeBspLayout,
} from "./quake-bsp-layout.js";

const LUMP_COUNT = 15;
const HEADER_SIZE = 4 + LUMP_COUNT * 8;

export interface QuakeBspLumps {
  readonly entities: BinaryView;
  readonly planes: BinaryView;
  readonly textures: BinaryView;
  readonly vertices: BinaryView;
  readonly visibility: BinaryView;
  readonly nodes: BinaryView;
  readonly texinfo: BinaryView;
  readonly faces: BinaryView;
  readonly lighting: BinaryView;
  readonly clipnodes: BinaryView;
  readonly leaves: BinaryView;
  readonly marksurfaces: BinaryView;
  readonly edges: BinaryView;
  readonly surfedges: BinaryView;
  readonly models: BinaryView;
}

type QuakeBspIdentification = BspIdentification & {
  readonly format: "quake-bsp29" | "quake-bsp2" | "goldsrc-bsp30";
};

export interface QuakeBspContainer {
  readonly identification: QuakeBspIdentification;
  readonly layout: QuakeBspLayout;
  readonly lumps: QuakeBspLumps;
}

function startsWithEntityBlock(lump: BinaryView): boolean {
  for (const byte of lump.bytes) {
    if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d)
      continue;
    return byte === 0x7b;
  }
  return false;
}

function parseLump(source: BinaryView, type: number): BinaryView {
  const header = 4 + type * 8;
  const offset = source.u32(header);
  const length = source.u32(header + 4);
  if (length > 0)
    invariant(offset >= HEADER_SIZE, `BSP lump ${type} overlaps its header`);
  source.require(offset, length, `BSP lump ${type}`);
  return source.slice(offset, length);
}

export function parseQuakeBspContainer(
  input: ArrayBuffer | ArrayBufferView,
): QuakeBspContainer {
  const source = new BinaryView(input);
  invariant(source.byteLength >= HEADER_SIZE, "BSP header is truncated");
  const version = source.u32(0);
  const layout = quakeBspLayout(version);
  if (!layout) {
    if (version === BSP2_2PSB_MAGIC) {
      throw new WorldviewError(
        "unsupported-bsp",
        "Worldview supports sanitized BSP2 but not the earlier 2PSB layout",
      );
    }
    throw new WorldviewError(
      "unsupported-bsp",
      `Worldview supports BSP29, BSP30, sanitized BSP2, and Quake II BSP38; received ${version}`,
    );
  }

  const identification = identifyBsp(input);
  if (!identification || identification.format === "quake2-bsp38") {
    invalidData("Quake-family BSP identification disagrees with its layout");
  }
  const lumps: QuakeBspLumps = {
    entities: parseLump(source, 0),
    planes: parseLump(source, 1),
    textures: parseLump(source, 2),
    vertices: parseLump(source, 3),
    visibility: parseLump(source, 4),
    nodes: parseLump(source, 5),
    texinfo: parseLump(source, 6),
    faces: parseLump(source, 7),
    lighting: parseLump(source, 8),
    clipnodes: parseLump(source, 9),
    leaves: parseLump(source, 10),
    marksurfaces: parseLump(source, 11),
    edges: parseLump(source, 12),
    surfedges: parseLump(source, 13),
    models: parseLump(source, 14),
  };

  // Gearbox's Blue Shift tools exchanged the BSP30 entity and plane directory entries.
  let { entities, planes } = lumps;
  if (
    layout.version === 30 &&
    !startsWithEntityBlock(entities) &&
    startsWithEntityBlock(planes)
  ) {
    [entities, planes] = [planes, entities];
  }

  return {
    identification,
    layout,
    lumps: {
      ...lumps,
      entities,
      planes,
    },
  };
}
