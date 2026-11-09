import { createWorld } from "bitecs";
import { sharedComponents } from "./ecs.shared";

const sharedWorldDefaults = () => ({
  components: { ...sharedComponents },
  time: { delta: 0, elapsed: 0, then: Date.now() },
  bounds: { x: 0, y: 0, w: 0, h: 0 },
});

export const createSharedWorld = <Extra extends object>(extra: Extra) =>
  createWorld({ ...sharedWorldDefaults(), ...extra });

export type SharedWorld = {
  components: typeof sharedComponents;
  time: { delta: number; elapsed: number; then: number };
  bounds: { x: number; y: number; w: number; h: number };
};
