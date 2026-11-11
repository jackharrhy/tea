import { MAX_INPUT_MSEC, type InputCmd } from "@harrhy/burger-core";

export type ValidatedInput = InputCmd;

/**
 * Validates an arbitrary JSON-decoded message into a trusted InputCmd, or
 * returns null if the message is malformed, replayed, or not an input.
 *
 * - Reject non-objects, wrong type tags, non-integer seq, replayed seq.
 * - Reject non-finite or negative msec; clamp valid values to
 *   [0, MAX_INPUT_MSEC] so a malicious client can't speed-hack by sending
 *   huge dt values.
 * - Coerce all directional/interact fields to booleans (so a malicious client
 *   can't smuggle non-boolean truthy values).
 * - Drop unknown fields (only the known ones survive into the returned shape).
 */
export const validateInput = (
  raw: unknown,
  lastSeq: number,
): ValidatedInput | null => {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (r.type !== "input") return null;
  if (typeof r.seq !== "number" || !Number.isInteger(r.seq) || r.seq < 0)
    return null;
  if (r.seq <= lastSeq) return null;

  if (typeof r.msec !== "number" || !Number.isFinite(r.msec) || r.msec < 0)
    return null;
  const msec = Math.min(r.msec, MAX_INPUT_MSEC);

  return {
    seq: r.seq,
    msec,
    up: !!r.up,
    down: !!r.down,
    left: !!r.left,
    right: !!r.right,
    interact: !!r.interact,
  };
};
