import { createHash } from "node:crypto";
import type { SpeechVoice } from "@tea/gurgur-engine";

type Bucket = {
  tokens: number;
  updatedAtMs: number;
};

const SESSION_CAPACITY = 2;
const SESSION_TOKENS_PER_MS = 1 / 2_000;
const GLOBAL_CAPACITY = 8;
const GLOBAL_TOKENS_PER_MS = 4 / 1_000;

export class SpeechRateLimiter {
  readonly #sessions = new Map<string, Bucket>();
  readonly #global: Bucket = { tokens: GLOBAL_CAPACITY, updatedAtMs: 0 };

  accept(
    sessionToken: string,
    nowMs: number,
  ): { accepted: boolean; retryAfterMs: number } {
    const session = this.#sessions.get(sessionToken) ?? {
      tokens: SESSION_CAPACITY,
      updatedAtMs: nowMs,
    };
    this.#sessions.set(sessionToken, session);
    refill(session, nowMs, SESSION_CAPACITY, SESSION_TOKENS_PER_MS);
    refill(this.#global, nowMs, GLOBAL_CAPACITY, GLOBAL_TOKENS_PER_MS);
    if (session.tokens < 1 || this.#global.tokens < 1) {
      return {
        accepted: false,
        retryAfterMs: Math.max(
          waitForToken(session, SESSION_TOKENS_PER_MS),
          waitForToken(this.#global, GLOBAL_TOKENS_PER_MS),
        ),
      };
    }
    session.tokens -= 1;
    this.#global.tokens -= 1;
    return { accepted: true, retryAfterMs: 0 };
  }

  forget(sessionToken: string): void {
    this.#sessions.delete(sessionToken);
  }
}

export function speechVoiceForSessionToken(sessionToken: string): SpeechVoice {
  const digest = createHash("sha256").update(sessionToken).digest();
  return (digest[0]! % 5) as SpeechVoice;
}

function refill(
  bucket: Bucket,
  nowMs: number,
  capacity: number,
  tokensPerMs: number,
): void {
  const elapsed = Math.max(0, nowMs - bucket.updatedAtMs);
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * tokensPerMs);
  bucket.updatedAtMs = Math.max(bucket.updatedAtMs, nowMs);
}

function waitForToken(bucket: Bucket, tokensPerMs: number): number {
  if (bucket.tokens >= 1) return 0;
  return Math.max(0, Math.ceil((1 - bucket.tokens) / tokensPerMs - 1e-6));
}
