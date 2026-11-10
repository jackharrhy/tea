import type { ServerTextMessage } from "./control-codec";
import type {
  BootstrapStatePacket,
  OwnershipChangedPacket,
  StateClusterPacket,
} from "./types";
import type { LifecycleMessage } from "./world";

export type ServerPacket =
  | ServerTextMessage
  | BootstrapStatePacket
  | StateClusterPacket
  | OwnershipChangedPacket
  | LifecycleMessage;
