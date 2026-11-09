export type InputCmd = {
  seq: number;
  // Real-world dt (ms) the client perceived for this input — i.e. the frame
  // delta during which these buttons were held. Server clamps to a sane
  // bound (see MAX_INPUT_MSEC) before applying physics, so a malicious
  // client can't send msec = 1e9 and teleport. Frame-rate independence
  // requires this: a 144Hz client emits ~144 inputs/sec at ~7ms each,
  // a 60Hz client emits ~60 at ~16.6ms each, and both result in the same
  // amount of authoritative motion per real second.
  msec: number;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  interact: boolean;
};

export type PlayerState = {
  eid: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  lastInputSeq: number;
};

export type GameStateMessage = {
  players: PlayerState[];
};
