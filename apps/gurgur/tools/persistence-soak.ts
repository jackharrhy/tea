import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorldStore, type PersistedWorld } from "../server/src/store";

const cycles = Number(process.env.PERSISTENCE_SOAK_CYCLES ?? 10_000);
if (!Number.isInteger(cycles) || cycles < 1)
  throw new Error("PERSISTENCE_SOAK_CYCLES must be a positive integer");
const directory = await mkdtemp(join(tmpdir(), "gurgur-persistence-soak-"));
const path = join(directory, "world.sqlite");
const mapRevision = "persistence-soak-map";
let store = new WorldStore(path);
const startedAt = performance.now();
try {
  for (let tick = 0; tick < cycles; tick += 1) {
    const world: PersistedWorld = {
      worldEpoch: 1 + Math.floor(tick / 2_500),
      serverTick: tick,
      bodies: [
        {
          authoredId: "body",
          position: { x: tick / 100, y: 1, z: -tick / 200 },
          rotation: { x: 0, y: 0, z: 0, w: 1 },
          linearVelocity: { x: 1, y: 0, z: -0.5 },
          angularVelocity: { x: 0, y: 0.1, z: 0 },
          awake: tick % 2 === 0,
        },
      ],
      gameState: {
        entities: [
          {
            kind: "linear-mover",
            authoredId: "door",
            progress: (tick % 100) / 100,
            direction: tick % 2 ? -1 : 1,
            resumeAtTick: tick + 5,
          },
          {
            kind: "trigger",
            authoredId: "trigger",
            readyAtTick: tick + 10,
            consumed: tick % 3 === 0,
          },
        ],
        delayedSignals: [{ target: "door", dueTick: tick + 20 }],
      },
      players: [
        {
          persistentId: "player",
          position: { x: tick / 100, y: 0.9, z: 0 },
          yaw: tick / 1_000,
          verticalVelocity: 0,
          grounded: true,
          lastJumpCounter: tick,
          stepCooldown: tick % 5,
          crouched: tick % 2 === 0,
          grabbedAuthoredId: tick % 4 === 0 ? "body" : null,
          grabDistance: 1.5,
        },
      ],
    };
    store.save(mapRevision, world);
    const loaded = store.load(mapRevision);
    if (
      !loaded ||
      loaded.serverTick !== tick ||
      loaded.bodies[0]?.position.x !== world.bodies[0]!.position.x
    ) {
      throw new Error(`persistence mismatch at cycle ${tick}`);
    }
    if ((tick + 1) % 1_000 === 0 && tick + 1 < cycles) {
      store.close();
      store = new WorldStore(path);
      if (store.load(mapRevision)?.serverTick !== tick)
        throw new Error(`reopen mismatch at cycle ${tick}`);
    }
  }
  const report = {
    reportVersion: 1,
    cycles,
    elapsedMs: performance.now() - startedAt,
    databaseBytes: Bun.file(path).size,
    memory: process.memoryUsage(),
  };
  await mkdir("reports/soak", { recursive: true });
  await Bun.write(
    "reports/soak/persistence.json",
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify(report));
} finally {
  store.close();
  await rm(directory, { recursive: true, force: true });
}
