import { addComponent, addEntity } from "bitecs";
import type { World } from "./world";

export const createPlayer = (world: World, name: string): number => {
  const { Player, Position, Velocity, Networked } = world.components;
  const eid = addEntity(world);

  addComponent(world, eid, Player);
  Player.name[eid] = name;

  const { spawnZone } = world;
  const x = spawnZone.x + Math.random() * spawnZone.w;
  const y = spawnZone.y + Math.random() * spawnZone.h;

  addComponent(world, eid, Position);
  Position.x[eid] = x;
  Position.y[eid] = y;

  addComponent(world, eid, Velocity);
  Velocity.x[eid] = 0;
  Velocity.y[eid] = 0;

  addComponent(world, eid, Networked);

  return eid;
};
