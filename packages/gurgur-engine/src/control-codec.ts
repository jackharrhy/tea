import { PROTOCOL_VERSION } from "./config";
import type {
  ClientControlMessage,
  HelloMessage,
  ManipulationChangedMessage,
  ManipulationDeniedMessage,
  ManipulationDropMessage,
  ManipulationRequestMessage,
  PingMessage,
  PongMessage,
  RtcAnswerMessage,
  RtcOfferMessage,
  SpeakMessage,
  SpeechMessage,
  SpeechRejectedMessage,
  UseRequestMessage,
  WelcomeMessage,
} from "./types";
import type { RuntimeEntityRef, WorldManifestMessage } from "./world";

type RecordValue = Record<string, unknown>;
const MAX_SERVER_CONTROL_LENGTH = 262_144;

export function decodeClientControl(text: string): ClientControlMessage {
  if (text.length === 0 || text.length > 32_768)
    throw new Error("control packet length is invalid");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("control packet is not valid JSON");
  }
  if (!record(value) || typeof value.type !== "string")
    throw new Error("control packet must be an object with a type");
  if (value.protocolVersion !== PROTOCOL_VERSION)
    throw new Error("control protocol version mismatch");
  if (value.type === "hello") return hello(value);
  if (value.type === "ping") return ping(value);
  if (value.type === "rtc-answer") return rtcAnswer(value);
  if (value.type === "speak") return speak(value);
  if (value.type === "manipulation-request") return manipulationRequest(value);
  if (value.type === "manipulation-drop") return manipulationDrop(value);
  if (value.type === "use-request") return useRequest(value);
  throw new Error("unknown control packet type");
}

export type ServerTextMessage =
  | WelcomeMessage
  | PongMessage
  | RtcOfferMessage
  | WorldManifestMessage
  | SpeechMessage
  | SpeechRejectedMessage
  | ManipulationChangedMessage
  | ManipulationDeniedMessage;

export function decodeServerControl(text: string): ServerTextMessage {
  const value = parseControl(text);
  if (value.type === "welcome") return welcome(value);
  if (value.type === "world") return world(value);
  if (value.type === "pong") return pong(value);
  if (value.type === "rtc-offer") return rtcOffer(value);
  if (value.type === "speech") return speech(value);
  if (value.type === "speech-rejected") return speechRejected(value);
  if (value.type === "manipulation-changed") return manipulationChanged(value);
  if (value.type === "manipulation-denied") return manipulationDenied(value);
  throw new Error("unknown control packet type");
}

function parseControl(text: string): RecordValue {
  if (text.length === 0 || text.length > MAX_SERVER_CONTROL_LENGTH)
    throw new Error("control packet length is invalid");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("control packet is not valid JSON");
  }
  if (!record(value) || typeof value.type !== "string")
    throw new Error("control packet must be an object with a type");
  if (value.protocolVersion !== PROTOCOL_VERSION)
    throw new Error("control protocol version mismatch");
  return value;
}

function hello(value: RecordValue): HelloMessage {
  exact(value, [
    "type",
    "protocolVersion",
    "mapRevision",
    "worldEpoch",
    "sessionToken",
    "socketGeneration",
  ]);
  if (
    !nullableString(value.mapRevision, 128) ||
    !nullableSafeInteger(value.worldEpoch, 0) ||
    !nullableString(value.sessionToken, 128) ||
    !safeInteger(value.socketGeneration, 0)
  ) {
    throw new Error("hello fields are invalid");
  }
  return value as HelloMessage;
}

function welcome(value: RecordValue): WelcomeMessage {
  exact(value, [
    "type",
    "protocolVersion",
    "worldEpoch",
    "playerId",
    "mapRevision",
    "physicsHz",
    "stateHz",
    "sessionToken",
    "socketGeneration",
  ]);
  if (
    !safeInteger(value.worldEpoch, 0) ||
    !runtimeId(value.playerId) ||
    !string(value.mapRevision, 128, 1) ||
    !finitePositive(value.physicsHz) ||
    !finitePositive(value.stateHz) ||
    !string(value.sessionToken, 128, 16) ||
    !safeInteger(value.socketGeneration, 0)
  ) {
    throw new Error("welcome fields are invalid");
  }
  return value as WelcomeMessage;
}

function world(value: RecordValue): WorldManifestMessage {
  exact(value, [
    "type",
    "protocolVersion",
    "worldEpoch",
    "mapRevision",
    "bundleUrl",
    "runtimeEntities",
  ]);
  if (
    !safeInteger(value.worldEpoch, 0) ||
    !string(value.mapRevision, 128, 1) ||
    !string(value.bundleUrl, 2_048, 1) ||
    !Array.isArray(value.runtimeEntities) ||
    value.runtimeEntities.length > 65_535
  ) {
    throw new Error("world fields are invalid");
  }
  for (const entity of value.runtimeEntities) validateRuntimeEntity(entity);
  return value as WorldManifestMessage;
}

function pong(value: RecordValue): PongMessage {
  exact(value, [
    "type",
    "protocolVersion",
    "worldEpoch",
    "nonce",
    "sentAtMs",
    "serverTick",
  ]);
  if (
    !safeInteger(value.worldEpoch, 0) ||
    !safeInteger(value.nonce, 0) ||
    !finite(value.sentAtMs) ||
    !safeInteger(value.serverTick, 0)
  )
    throw new Error("pong fields are invalid");
  return value as PongMessage;
}

function ping(value: RecordValue): PingMessage {
  exact(value, ["type", "protocolVersion", "worldEpoch", "nonce", "sentAtMs"]);
  if (
    !safeInteger(value.worldEpoch, 0) ||
    !safeInteger(value.nonce, 0) ||
    !finite(value.sentAtMs)
  ) {
    throw new Error("ping fields are invalid");
  }
  return value as PingMessage;
}

function speak(value: RecordValue): SpeakMessage {
  exact(value, ["type", "protocolVersion", "worldEpoch", "requestId", "text"]);
  if (
    !safeInteger(value.worldEpoch, 0) ||
    !safeInteger(value.requestId, 0) ||
    !speechText(value.text)
  ) {
    throw new Error("speak fields are invalid");
  }
  return value as SpeakMessage;
}

function speech(value: RecordValue): SpeechMessage {
  exact(value, [
    "type",
    "protocolVersion",
    "worldEpoch",
    "requestId",
    "speakerId",
    "voice",
    "text",
  ]);
  if (
    !safeInteger(value.worldEpoch, 0) ||
    !safeInteger(value.requestId, 0) ||
    !runtimeId(value.speakerId) ||
    !safeInteger(value.voice, 0) ||
    value.voice > 4 ||
    !speechText(value.text)
  ) {
    throw new Error("speech fields are invalid");
  }
  return value as SpeechMessage;
}

function speechRejected(value: RecordValue): SpeechRejectedMessage {
  exact(value, [
    "type",
    "protocolVersion",
    "worldEpoch",
    "requestId",
    "reason",
    "retryAfterMs",
  ]);
  if (
    !safeInteger(value.worldEpoch, 0) ||
    !safeInteger(value.requestId, 0) ||
    !["rate-limited", "world-changed"].includes(value.reason as string) ||
    !safeInteger(value.retryAfterMs, 0)
  ) {
    throw new Error("speech rejection fields are invalid");
  }
  return value as SpeechRejectedMessage;
}

function manipulationRequest(value: RecordValue): ManipulationRequestMessage {
  exact(value, [
    "type",
    "protocolVersion",
    "worldEpoch",
    "requestId",
    "target",
    "authorityVersion",
    "localAnchor",
    "holdDistance",
  ]);
  if (
    !safeInteger(value.worldEpoch, 0) ||
    !safeInteger(value.requestId, 0) ||
    !runtimeId(value.target) ||
    !safeInteger(value.authorityVersion, 0) ||
    !vec3(value.localAnchor) ||
    !finite(value.holdDistance) ||
    value.holdDistance < 0.25 ||
    value.holdDistance > 10
  ) {
    throw new Error("manipulation request fields are invalid");
  }
  return value as ManipulationRequestMessage;
}

function manipulationDrop(value: RecordValue): ManipulationDropMessage {
  exact(value, [
    "type",
    "protocolVersion",
    "worldEpoch",
    "target",
    "authorityVersion",
    "claimVersion",
  ]);
  if (
    !safeInteger(value.worldEpoch, 0) ||
    !runtimeId(value.target) ||
    !safeInteger(value.authorityVersion, 0) ||
    !safeInteger(value.claimVersion, 1)
  ) {
    throw new Error("manipulation drop fields are invalid");
  }
  return value as ManipulationDropMessage;
}

function useRequest(value: RecordValue): UseRequestMessage {
  exact(value, [
    "type",
    "protocolVersion",
    "worldEpoch",
    "requestId",
    "target",
  ]);
  if (
    !safeInteger(value.worldEpoch, 0) ||
    !safeInteger(value.requestId, 0) ||
    !runtimeId(value.target)
  ) {
    throw new Error("use request fields are invalid");
  }
  return value as UseRequestMessage;
}

function manipulationChanged(value: RecordValue): ManipulationChangedMessage {
  exact(value, [
    "type",
    "protocolVersion",
    "worldEpoch",
    "requestId",
    "target",
    "authorityVersion",
    "claimVersion",
    "manipulatorPlayerId",
  ]);
  if (
    !safeInteger(value.worldEpoch, 0) ||
    !nullableSafeInteger(value.requestId, 0) ||
    !runtimeId(value.target) ||
    !safeInteger(value.authorityVersion, 0) ||
    !safeInteger(value.claimVersion, 1) ||
    (value.manipulatorPlayerId !== null &&
      !runtimeId(value.manipulatorPlayerId))
  ) {
    throw new Error("manipulation change fields are invalid");
  }
  return value as ManipulationChangedMessage;
}

function manipulationDenied(value: RecordValue): ManipulationDeniedMessage {
  exact(value, [
    "type",
    "protocolVersion",
    "worldEpoch",
    "requestId",
    "target",
    "reason",
  ]);
  if (
    !safeInteger(value.worldEpoch, 0) ||
    !safeInteger(value.requestId, 0) ||
    !runtimeId(value.target) ||
    !["stale", "unavailable", "out-of-range", "busy"].includes(
      value.reason as string,
    )
  ) {
    throw new Error("manipulation denial fields are invalid");
  }
  return value as ManipulationDeniedMessage;
}

function rtcOffer(value: RecordValue): RtcOfferMessage {
  exact(value, [
    "type",
    "protocolVersion",
    "worldEpoch",
    "description",
    "iceServers",
  ]);
  if (
    !safeInteger(value.worldEpoch, 0) ||
    !sessionDescription(value.description, "offer") ||
    !iceServers(value.iceServers)
  ) {
    throw new Error("RTC offer fields are invalid");
  }
  return value as RtcOfferMessage;
}

function iceServers(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > 8) return false;
  return value.every((server) => {
    if (!record(server)) return false;
    exact(server, [
      "urls",
      ...("username" in server ? ["username"] : []),
      ...("credential" in server ? ["credential"] : []),
    ]);
    return (
      string(server.urls, 2_048, 1) &&
      /^(?:stun|stuns|turn|turns):/.test(server.urls) &&
      (!("username" in server) || string(server.username, 1_024)) &&
      (!("credential" in server) || string(server.credential, 1_024))
    );
  });
}

function rtcAnswer(value: RecordValue): RtcAnswerMessage {
  exact(value, ["type", "protocolVersion", "worldEpoch", "description"]);
  if (
    !safeInteger(value.worldEpoch, 0) ||
    !sessionDescription(value.description, "answer")
  ) {
    throw new Error("RTC answer fields are invalid");
  }
  return value as RtcAnswerMessage;
}

function sessionDescription(value: unknown, type: "offer" | "answer"): boolean {
  if (!record(value)) return false;
  exact(value, ["type", "sdp"]);
  return value.type === type && string(value.sdp, 32_768, 1);
}

function validateRuntimeEntity(
  value: unknown,
): asserts value is RuntimeEntityRef {
  if (!record(value)) throw new Error("runtime entity is invalid");
  const authorityFields = [
    "id",
    "kind",
    "ownerPlayerId",
    "authorityVersion",
    "transferPolicy",
  ];
  if (value.kind === "world-entity") {
    exact(value, [...authorityFields, "entityIndex"]);
    if (
      !runtimeId(value.id) ||
      !safeInteger(value.entityIndex, 0) ||
      !authorityDescriptor(value)
    )
      throw new Error("runtime world entity is invalid");
    return;
  }
  exact(value, authorityFields);
  if (
    value.kind !== "player" ||
    !runtimeId(value.id) ||
    !authorityDescriptor(value)
  )
    throw new Error("runtime player entity is invalid");
}

function authorityDescriptor(value: RecordValue): boolean {
  return (
    (value.ownerPlayerId === null || runtimeId(value.ownerPlayerId)) &&
    safeInteger(value.authorityVersion, 0) &&
    value.transferPolicy === "fixed"
  );
}

function runtimeId(value: unknown): boolean {
  if (!record(value)) return false;
  exact(value, ["index", "generation"]);
  return safeInteger(value.index, 0) && safeInteger(value.generation, 0);
}

function vec3(value: unknown): boolean {
  if (!record(value)) return false;
  exact(value, ["x", "y", "z"]);
  return finite(value.x) && finite(value.y) && finite(value.z);
}

function record(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: RecordValue, fields: string[]): void {
  if (Object.keys(value).some((key) => !fields.includes(key)))
    throw new Error("control packet has unknown fields");
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function finitePositive(value: unknown): value is number {
  return finite(value) && value > 0;
}

function safeInteger(value: unknown, minimum: number): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= minimum
  );
}

function string(value: unknown, maximum: number, minimum = 0): value is string {
  return (
    typeof value === "string" &&
    value.length >= minimum &&
    value.length <= maximum
  );
}

export function validSpeechText(value: unknown): boolean {
  return speechText(value);
}

function speechText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 120 &&
    value.trim().length > 0 &&
    !value.includes("[[") &&
    /^[\x20-\x7e]+$/.test(value)
  );
}

function nullableString(
  value: unknown,
  maximum: number,
): value is string | null {
  return value === null || string(value, maximum);
}

function nullableSafeInteger(
  value: unknown,
  minimum: number,
): value is number | null {
  return value === null || safeInteger(value, minimum);
}
