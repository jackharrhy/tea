import { expect, test } from "bun:test";
import type { ShotAck, Snapshot, TableState } from "@tea/pool-protocol";
import { createMatch } from "@tea/pool";
import {
  ShotCommands,
  type ShotCommand,
} from "../../../app/game/prediction/shot-command";

const shot = { table: "1", turn: 7, angle: 0.4, power: 0.6 };
function ack(command: ShotCommand, accepted = true): ShotAck {
  return {
    type: "shot-ack",
    id: command.id,
    table: command.table,
    turn: command.turn,
    accepted,
    time: 100,
  };
}
function snapshot(
  phase: TableState["match"]["phase"],
  turn = shot.turn,
): Snapshot {
  return {
    type: "state",
    time: 100,
    tick: 6,
    players: [],
    tables: [
      {
        id: "1",
        rack: 0,
        balls: [],
        rematchReady: [],
        match: { ...createMatch(), phase, shotNumber: turn },
      },
    ],
  };
}

test("retries retain the command ID, failed sends remain retryable, acknowledgment stops retries", () => {
  const sent: ShotCommand[] = [];
  const warnings: string[] = [];
  let writable = false;
  const shots = new ShotCommands(
    (command) => {
      if (!writable) return false;
      sent.push(command);
      return true;
    },
    (text) => warnings.push(text),
  );
  expect(shots.start(shot)).toBeNull();
  expect(shots.pending).toBeNull();
  writable = true;
  const command = shots.start(shot)!;
  const at = shots.pending!.at;
  expect(shots.start({ ...shot, angle: 1 })).toBeNull();
  expect(shots.pending!.command).toBe(command);
  expect(sent).toHaveLength(1);
  shots.tick(at + 399);
  expect(sent).toHaveLength(1);
  writable = false;
  shots.tick(at + 400);
  expect(shots.pending!.lastSent).toBe(at);
  writable = true;
  shots.tick(at + 401);
  expect(sent).toEqual([command, command]);
  expect(shots.acknowledge({ ...ack(command), id: "old-shot" })).toBe(false);
  shots.tick(at + 802);
  expect(sent).toHaveLength(3);
  shots.acknowledge(ack(command));
  shots.tick(at + 1201);
  expect(sent).toHaveLength(3);
  shots.tick(at + 3001);
  shots.tick(at + 4001);
  expect(warnings).toHaveLength(1);
  expect(shots.pending).not.toBeNull();
  shots.ingest(snapshot("rolling"));
  expect(shots.pending).toBeNull();
});

test("rejection, table removal, turn advance and cancellation retire pending shots", () => {
  const shots = new ShotCommands(
    () => true,
    () => {},
  );
  const first = shots.start(shot)!;
  expect(shots.acknowledge(ack(first, false))).toBe(true);
  expect(shots.pending).toBeNull();
  const next = shots.start(shot)!;
  expect(next.id).not.toBe(first.id);
  expect(shots.acknowledge(ack(first, false))).toBe(false);
  expect(shots.pending!.command).toBe(next);
  shots.ingest(snapshot("aiming"));
  expect(shots.pending).not.toBeNull();
  shots.ingest(snapshot("aiming", 8));
  expect(shots.pending).toBeNull();
  shots.start(shot);
  shots.ingest({ ...snapshot("aiming"), tables: [] });
  expect(shots.pending).toBeNull();
  shots.start(shot);
  shots.cancel();
  expect(shots.pending).toBeNull();
});
