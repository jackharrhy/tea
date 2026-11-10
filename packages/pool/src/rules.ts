import type { Ball, ShotResult } from "./physics";

type Group = "solid" | "stripe";
export interface PoolMatch {
  phase: "waiting" | "aiming" | "rolling" | "ball-in-hand" | "finished";
  players: [string | null, string | null];
  turn: 0 | 1;
  groups: [Group | null, Group | null];
  winner: string | null;
  message: string;
  shotNumber: number;
}

export function createMatch(): PoolMatch {
  return {
    phase: "waiting",
    players: [null, null],
    turn: 0,
    groups: [null, null],
    winner: null,
    message: "Waiting for two players.",
    shotNumber: 0,
  };
}

export function startMatch(match: PoolMatch, players: [string, string]): void {
  if (!players[0] || !players[1] || players[0] === players[1]) {
    throw new Error("Two distinct player IDs are required");
  }
  Object.assign(match, createMatch(), {
    players: [...players],
    phase: "aiming",
    message: `${players[0]} to break.`,
  });
}

function groupOf(id: number): Group | null {
  if (id >= 1 && id <= 7) return "solid";
  if (id >= 9 && id <= 15) return "stripe";
  return null;
}

export function resolveShot(
  match: PoolMatch,
  balls: Ball[],
  result: ShotResult,
): void {
  if (match.phase === "waiting" || match.phase === "finished") return;
  const shooter = match.turn;
  const opponent = shooter === 0 ? 1 : 0;
  const group = match.groups[shooter];
  const potted = new Set(result.potted);
  const wasOnEight =
    group !== null &&
    !balls.some(
      (ball) =>
        groupOf(ball.id) === group && (!ball.pocketed || potted.has(ball.id)),
    );
  const first = result.firstContact;
  const scratch =
    potted.has(0) || balls.some((ball) => ball.id === 0 && ball.pocketed);
  let foul = "";
  if (scratch) foul = "Cue ball scratched.";
  else if (first === null) foul = "No object ball contacted.";
  else if (
    wasOnEight
      ? first !== 8
      : group
        ? groupOf(first) !== group
        : groupOf(first) === null
  ) {
    foul = "Wrong ball contacted first.";
  } else if (
    !result.railAfterContact &&
    !result.potted.some((id) => id !== 0)
  ) {
    foul = "No ball pocketed or rail contacted after first contact.";
  }
  match.shotNumber++;
  if (potted.has(8)) {
    const legal = wasOnEight && !foul;
    match.phase = "finished";
    match.winner = match.players[legal ? shooter : opponent];
    match.message = legal
      ? "Eight ball pocketed legally."
      : "Illegal eight ball: opponent wins.";
    return;
  }
  if (foul) {
    match.turn = opponent;
    match.phase = "ball-in-hand";
    match.message = `${foul} Opponent has ball in hand.`;
    return;
  }
  if (group === null) {
    const assigned = result.potted.map(groupOf).find((value) => value !== null);
    if (assigned) {
      match.groups[shooter] = assigned;
      match.groups[opponent] = assigned === "solid" ? "stripe" : "solid";
    }
  }
  const retained = result.potted.some(
    (id) => groupOf(id) !== null && groupOf(id) === match.groups[shooter],
  );
  match.turn = retained ? shooter : opponent;
  match.phase = "aiming";
  match.message = retained
    ? "Ball pocketed. Shoot again."
    : "Turn passes to opponent.";
}
