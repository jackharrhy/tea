import { str } from "bitecs/serialization";

export const MAX_ENTITIES = 2000;

const Player = { name: str([]) };
const Position = {
  x: new Float32Array(MAX_ENTITIES),
  y: new Float32Array(MAX_ENTITIES),
};
const Velocity = {
  x: new Float32Array(MAX_ENTITIES),
  y: new Float32Array(MAX_ENTITIES),
};
// Tile.type holds the catalog id (from atlas.toml / tile_catalog), not the
// narrow TileType union — wider to accommodate user-defined tiles. The catalog
// row's `type` field carries the floor/wall/counter classification.
const Tile = { type: [] as number[] };
const Networked = {};
const Solid = {};
const Bot = {};

export const sharedComponents = {
  Player,
  Position,
  Velocity,
  Tile,
  Networked,
  Solid,
  Bot,
};

export const networkedComponents = [Player, Position, Tile, Solid, Bot];
