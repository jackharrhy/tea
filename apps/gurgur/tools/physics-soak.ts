import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import {
  PHYSICS_DT,
  PHYSICS_SUBSTEPS,
  PhysicsWorld,
} from "@harrhy/gurgur-engine";

const churnCycles = Number(process.env.PHYSICS_CHURN_CYCLES ?? 10_000);
const tickCount = Number(process.env.PHYSICS_SOAK_TICKS ?? 1_000_000);
if (
  !Number.isInteger(churnCycles) ||
  churnCycles < 1 ||
  !Number.isInteger(tickCount) ||
  tickCount < 1
) {
  throw new Error("physics soak counts must be positive integers");
}
const world = await PhysicsWorld.create();
const startedAt = performance.now();
let firstIndex = -1;
let lastGeneration = 0;
try {
  for (let cycle = 0; cycle < churnCycles; cycle += 1) {
    const body = world.createBox({
      type: "dynamic",
      position: { x: 0, y: 1, z: 0 },
      halfExtents: { x: 0.25, y: 0.25, z: 0.25 },
    });
    if (cycle === 0) firstIndex = body.index;
    if (body.index !== firstIndex || body.generation <= lastGeneration)
      throw new Error(`handle churn failed at cycle ${cycle}`);
    lastGeneration = body.generation;
    if (!world.destroy(body))
      throw new Error(`destroy failed at cycle ${cycle}`);
    if (world.destroy(body))
      throw new Error(`stale handle survived cycle ${cycle}`);
  }
  world.createBox({
    type: "static",
    position: { x: 0, y: -0.5, z: 0 },
    halfExtents: { x: 2, y: 0.5, z: 2 },
  });
  const dropPosition = { x: 0, y: 2, z: 0 };
  const rotation = { x: 0, y: 0, z: 0, w: 1 };
  const zeroVelocity = { x: 0, y: 0, z: 0 };
  const fallingBody = world.createBox({
    type: "dynamic",
    position: dropPosition,
    halfExtents: { x: 0.25, y: 0.25, z: 0.25 },
  });
  const hasher = createHash("sha256");
  const checkpointInterval = Math.max(1, Math.floor(tickCount / 10));
  for (let tick = 1; tick <= tickCount; tick += 1) {
    if (tick > 1 && (tick - 1) % 120 === 0) {
      world.setBodyTransform(fallingBody, dropPosition, rotation);
      world.setBodyVelocity(fallingBody, zeroVelocity, zeroVelocity);
      world.setBodyAwake(fallingBody, true);
    }
    world.step(PHYSICS_DT, PHYSICS_SUBSTEPS);
    if (tick % checkpointInterval === 0 || tick === tickCount) {
      const state = world.state(fallingBody);
      if (
        ![
          ...Object.values(state.position),
          ...Object.values(state.rotation),
          ...Object.values(state.linearVelocity),
          ...Object.values(state.angularVelocity),
        ].every(Number.isFinite)
      )
        throw new Error(`non-finite body state at tick ${tick}`);
      hasher.update(`${tick}:${JSON.stringify(world.snapshot())}\n`);
    }
  }
  const report = {
    reportVersion: 1,
    churnCycles,
    tickCount,
    finalGeneration: lastGeneration,
    checkpointHash: hasher.digest("hex"),
    elapsedMs: performance.now() - startedAt,
    memory: process.memoryUsage(),
  };
  await mkdir("reports/soak", { recursive: true });
  await Bun.write(
    "reports/soak/physics.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report));
} finally {
  world.dispose();
}
