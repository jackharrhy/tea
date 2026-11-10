import invariant from "tiny-invariant";
import { addComponent } from "bitecs";
import { moveAndSlide } from "@tea/burger-core";
import type { World } from "./world";
import { createPlayer } from "./players";

const AI_COUNT = 10;
const AI_SPEED = 0.15;
const DIRECTION_CHANGE_INTERVAL = 2000;

type AiState = {
  eid: number;
  targetAngle: number;
  nextDirectionChange: number;
};

const aiEntities: AiState[] = [];

export const spawnAiPlayers = (world: World): void => {
  const { Bot } = world.components;

  for (let i = 0; i < AI_COUNT; i++) {
    const botName = `Bot ${i + 1}`;

    const eid = createPlayer(world, botName);

    addComponent(world, eid, Bot);

    aiEntities.push({
      eid,
      targetAngle: Math.random() * Math.PI * 2,
      nextDirectionChange:
        performance.now() + Math.random() * DIRECTION_CHANGE_INTERVAL,
    });
  }

  console.log(`Spawned ${AI_COUNT} AI bots`);
};

export const updateAiPlayers = (world: World, tickRateMs: number): void => {
  const { Position, Velocity } = world.components;
  const now = performance.now();

  for (const ai of aiEntities) {
    const { eid } = ai;

    invariant(Position.x[eid] !== undefined);
    invariant(Position.y[eid] !== undefined);
    invariant(Velocity.x[eid] !== undefined);
    invariant(Velocity.y[eid] !== undefined);

    const timeToChange = now > ai.nextDirectionChange;

    if (timeToChange) {
      ai.targetAngle = Math.random() * Math.PI * 2;
      ai.nextDirectionChange =
        now +
        DIRECTION_CHANGE_INTERVAL +
        Math.random() * DIRECTION_CHANGE_INTERVAL;
    }

    Velocity.x[eid] = Math.cos(ai.targetAngle) * AI_SPEED;
    Velocity.y[eid] = Math.sin(ai.targetAngle) * AI_SPEED;

    const newPos = moveAndSlide(
      world,
      Position.x[eid],
      Position.y[eid],
      Velocity.x[eid],
      Velocity.y[eid],
      tickRateMs,
    );
    Position.x[eid] = newPos.x;
    Position.y[eid] = newPos.y;
  }
};

export const getAiEntities = (): AiState[] => aiEntities;

// Teleport all bots to fresh random positions inside world.spawnZone, zero
// their velocity, and reset their AI direction state so they pause briefly
// before wandering. Same eids; clients see the position change via the next
// GAME_STATE broadcast (no observer events). Returns the count reset.
export const resetAiPlayers = (world: World): number => {
  const { Position, Velocity } = world.components;
  const { spawnZone } = world;
  const now = performance.now();

  for (const ai of aiEntities) {
    const { eid } = ai;
    Position.x[eid] = spawnZone.x + Math.random() * spawnZone.w;
    Position.y[eid] = spawnZone.y + Math.random() * spawnZone.h;
    Velocity.x[eid] = 0;
    Velocity.y[eid] = 0;
    ai.targetAngle = Math.random() * Math.PI * 2;
    ai.nextDirectionChange =
      now +
      DIRECTION_CHANGE_INTERVAL +
      Math.random() * DIRECTION_CHANGE_INTERVAL;
  }

  return aiEntities.length;
};
