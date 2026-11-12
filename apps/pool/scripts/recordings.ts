import { Database } from "bun:sqlite";
import { statSync, writeFileSync } from "node:fs";
import { createShotResult } from "@harrhy/pool";
import { parseRecording } from "@harrhy/pool/recording";
import {
  exportRecording,
  exportClientTraces,
  listRecordings,
} from "../server/recordings";

const [command, path, id, output] = process.argv.slice(2);
if (command === "compare" && path) {
  if (statSync(path).size > 64 * 1024 * 1024)
    throw new Error("Recording exceeds 64 MB; export a single shot");
  const recording = parseRecording(await Bun.file(path).json());
  const { PoolPhysics } = await import("@harrhy/pool/engine");
  for (const shot of recording.shots) {
    if (shot.flags.includes("gravity_changed")) {
      console.log(
        JSON.stringify({
          shotId: shot.id,
          unsupported: "Gravity changed during the shot",
        }),
      );
      continue;
    }
    const engine = new PoolPhysics(shot.initial);
    try {
      engine.setGravity(shot.gravity ?? [0, -9.81, 0]);
      const result = createShotResult();
      engine.strike(shot.command.angle, shot.command.power);
      let maxError = 0,
        firstDivergenceMs: number | null = null;
      for (const frame of shot.frames) {
        engine.step(frame.dt, result);
        for (const expected of frame.balls) {
          const actual = engine.balls.find((b) => b.id === expected.id)!;
          const error = Math.hypot(
            actual.x - expected.x,
            actual.y - expected.y,
            actual.z - expected.z,
          );
          maxError = Math.max(maxError, error);
          if (
            firstDivergenceMs === null &&
            (error > 0.02 || actual.pocketed !== expected.pocketed)
          )
            firstDivergenceMs = frame.at;
        }
      }
      console.log(
        JSON.stringify({
          shotId: shot.id,
          recordedBuild: shot.build,
          frames: shot.frames.length,
          maxPositionErrorMetres: maxError,
          firstDivergenceMs,
          recordedPotted: shot.outcome?.result.potted,
          currentPotted: result.potted,
          note: "Fresh native contact caches can diverge. Recorded-frame playback preserves the captured trajectory; this compares it with the current simulation.",
        }),
      );
    } finally {
      engine.dispose();
    }
  }
} else if (
  (command === "list" || command === "export" || command === "traces") &&
  path
) {
  const db = new Database(path, { readonly: true });
  try {
    if (command === "list") {
      console.table(listRecordings(db));
      if (id) console.table(listRecordings(db, id));
    } else {
      if (!id || !output)
        throw new Error(
          "export requires a game or shot ID and a new output filename",
        );
      const recording = parseRecording(exportRecording(db, id));
      if (
        command === "traces" &&
        (recording.shots.length !== 1 || recording.shots[0].id !== id)
      )
        throw new Error("Trace export requires a shot ID");
      const clientTraces =
        command === "traces" ? exportClientTraces(db, id) : undefined;
      const json = JSON.stringify(
        clientTraces ? { ...recording, clientTraces } : recording,
      );
      if (Buffer.byteLength(json) > 64 * 1024 * 1024)
        throw new Error(
          "Game exceeds 64 MB; export an individual shot instead",
        );
      writeFileSync(output, json, { flag: "wx", mode: 0o600 });
      console.log(
        `Exported ${recording.shots.length} shot(s)${clientTraces ? ` with ${clientTraces.length} client trace(s)` : ""} to ${output}`,
      );
    }
  } finally {
    db.close();
  }
} else {
  console.log(
    "Usage:\n  bun run recordings list <database> [game-id]\n  bun run recordings export <database> <game-or-shot-id> <new-file.json>\n  bun run recordings traces <database> <shot-id> <new-file.json>\n  bun run recordings compare <recording.json>",
  );
  process.exitCode = 1;
}
