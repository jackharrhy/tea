import { unwrapTick32 } from "./source-tick";
import type { NetworkObjectState } from "./types";

export function isNewerSequence16(candidate: number, current: number): boolean {
  const difference = (candidate - current) & 0xffff;
  return difference !== 0 && difference < 0x8000;
}

export function isStaleNetworkState(
  candidate: NetworkObjectState,
  current: NetworkObjectState,
): boolean {
  if (candidate.authorityVersion !== current.authorityVersion)
    return candidate.authorityVersion < current.authorityVersion;
  return (
    unwrapTick32(candidate.sourceTick, current.sourceTick) <
      current.sourceTick ||
    (candidate.stateSequence !== current.stateSequence &&
      !isNewerSequence16(candidate.stateSequence, current.stateSequence))
  );
}

export function cloneNetworkState<T extends NetworkObjectState>(state: T): T {
  return {
    ...state,
    id: { ...state.id },
    position: { ...state.position },
    rotation: { ...state.rotation },
    linearVelocity: { ...state.linearVelocity },
    angularVelocity: { ...state.angularVelocity },
  };
}
