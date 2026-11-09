import { expect, test } from "bun:test";
import {
  BALL_RADIUS,
  TABLE_HALF_LENGTH,
  TABLE_HALF_WIDTH,
  canPlaceCue,
  createMatch,
  createRack,
  createShotResult,
  placeCue,
  resolveShot,
  startMatch,
  type Ball,
  type PoolMatch,
} from "@tea/pool";
import { PoolPhysics } from "@tea/pool/engine";
import { POCKETS } from "@tea/pool/table";
import { chooseBotPlacement, chooseBotShot } from "../../server/bot";

const ball = (id: number, x: number, z: number): Ball => ({
  id,
  x,
  z,
  vx: 0,
  vz: 0,
  pocketed: false,
});
function match() {
  const state = createMatch();
  startMatch(state, ["bot", "opponent"]);
  return state;
}
function play(balls: Ball[], state: PoolMatch, seat: 0 | 1 = 0) {
  const before = structuredClone({ balls, state });
  const shot = chooseBotShot(balls, state, seat);
  expect({ balls, state }).toEqual(before);
  expect(Number.isFinite(shot.angle)).toBe(true);
  expect(shot.power).toBeGreaterThan(0);
  expect(shot.power).toBeLessThanOrEqual(1);
  const engine = new PoolPhysics(balls);
  try {
    const result = createShotResult();
    engine.strike(shot.angle, shot.power);
    let moving = true;
    for (let frame = 0; moving && frame < 1200; frame++)
      moving = engine.step(1 / 60, result);
    expect(moving).toBe(false);
    return { balls: structuredClone(engine.balls), result };
  } finally {
    engine.dispose();
  }
}

test.each(POCKETS)(
  "pots an easy straight shot without scratching: %j",
  ({ x, z }) => {
    const nx = Math.sign(x);
    const nz = Math.sign(z);
    const length = Math.hypot(nx, nz);
    const inward = (distance: number) => ({
      x: x - (distance * nx) / length,
      z: z - (distance * nz) / length,
    });
    const cue = inward(0.55);
    const target = inward(0.275);
    const { result } = play(
      [ball(0, cue.x, cue.z), ball(1, target.x, target.z)],
      match(),
    );
    expect(result.firstContact).toBe(1);
    expect(result.potted).toContain(1);
    expect(result.potted).not.toContain(0);
  },
);

test("pots a modest cut with the ghost-ball aim", () => {
  const { result } = play([ball(0, -0.175, -0.125), ball(1, 0.25, 0)], match());
  expect(result.firstContact).toBe(1);
  expect(result.potted).toContain(1);
  expect(result.potted).not.toContain(0);
});

test("respects each seat's group and switches to eight only after clearing", () => {
  for (const seat of [0, 1] as const) {
    const state = match();
    state.groups = ["solid", "stripe"];
    state.turn = seat;
    const balls = [
      ball(0, 0, 0),
      ball(1, 0.3, 0),
      ball(9, -0.3, 0),
      ball(8, 0, 0.5),
    ];
    const own = seat === 0 ? 1 : 9;
    expect(play(balls, state, seat).result.firstContact).toBe(own);
    balls.find((b) => b.id === own)!.pocketed = true;
    Object.assign(balls[3]!, { x: seat === 0 ? 0.3 : -0.3, z: 0 });
    const finished = play(balls, state, seat);
    expect(finished.result.firstContact).toBe(8);
    expect(finished.result.potted).toContain(8);
    resolveShot(state, finished.balls, finished.result);
    expect(state.winner).toBe(state.players[seat]);
  }
  const open = play(
    [ball(0, 0, 0), ball(8, 0.2, 0), ball(9, -0.3, 0)],
    match(),
  );
  expect(open.result.firstContact).toBe(9);
});

test("avoids blocked cue and object paths when another legal target is clear", () => {
  for (const blocked of [
    [ball(1, 0, 0.5), ball(9, 0, 0.25), ball(2, 0.3, 0)],
    [ball(1, 0.25, 0), ball(9, 0.4, 0), ball(2, 0, 0.5)],
  ]) {
    const state = match();
    state.groups = ["solid", "stripe"];
    expect(play([ball(0, 0, 0), ...blocked], state).result.firstContact).toBe(
      2,
    );
  }
});

test("crowded ball-in-hand placement is legal, useful, and leaves inputs untouched", () => {
  const state = match();
  state.phase = "ball-in-hand";
  state.groups = ["solid", "stripe"];
  const balls = [ball(0, 0, 0), ball(1, 0.3, 0)];
  balls[0]!.pocketed = true;
  for (let id = 2; id <= 15; id++)
    balls.push(
      ball(
        id,
        ((((id - 2) % 4) - 1.5) / 4) * (TABLE_HALF_WIDTH - BALL_RADIUS),
        (-1 + Math.floor((id - 2) / 4) / 8) * (TABLE_HALF_LENGTH - BALL_RADIUS),
      ),
    );
  const before = structuredClone({ balls, state });
  const position = chooseBotPlacement(balls, state, 0);
  expect(canPlaceCue(balls, position.x, position.z)).toBe(true);
  expect({ balls, state }).toEqual(before);
  expect(placeCue(balls, position.x, position.z)).toBe(true);
  const { result } = play(balls, state);
  expect(result.firstContact).toBeGreaterThanOrEqual(1);
  expect(result.firstContact).toBeLessThanOrEqual(7);
  expect(result.potted.some((id) => id >= 1 && id <= 7)).toBe(true);
  expect(result.potted).not.toContain(0);
});

test("a packed rack falls back to a legal contact with enough power to reach a rail", () => {
  const { result } = play(createRack(), match());
  expect(result.firstContact).toBe(1);
  expect(result.railAfterContact || result.potted.length > 0).toBe(true);
});
