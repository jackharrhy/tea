import {
  unwrapTick32,
  type NetworkPlayerState,
  type PredictionCheckpointPacket,
} from "@harrhy/gurgur-engine";

export function acceptsPredictionCheckpoint(
  checkpoint: PredictionCheckpointPacket,
  current: {
    worldEpoch: number;
    player: Pick<NetworkPlayerState, "id" | "authorityVersion">;
    serverTick: number | null;
    acknowledgedInputSequence: number;
  },
): boolean {
  if (
    checkpoint.worldEpoch !== current.worldEpoch ||
    checkpoint.player.id.index !== current.player.id.index ||
    checkpoint.player.id.generation !== current.player.id.generation ||
    checkpoint.player.authorityVersion < current.player.authorityVersion
  )
    return false;
  if (checkpoint.player.authorityVersion > current.player.authorityVersion)
    return true;
  if (
    (checkpoint.lastProcessedInputSequence ?? -1) <
    current.acknowledgedInputSequence
  )
    return false;
  return (
    current.serverTick === null ||
    unwrapTick32(checkpoint.serverTick, current.serverTick) > current.serverTick
  );
}
