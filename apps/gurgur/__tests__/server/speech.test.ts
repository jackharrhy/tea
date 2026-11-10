import { describe, expect, test } from "bun:test";
import {
  SpeechRateLimiter,
  speechVoiceForSessionToken,
} from "../../server/src/speech";

describe("coordinator speech policy", () => {
  test("assigns one stable ordinary voice from the server session token", () => {
    const token = "01234567-89ab-cdef-0123-456789abcdef";
    const voice = speechVoiceForSessionToken(token);
    expect(voice).toBeGreaterThanOrEqual(0);
    expect(voice).toBeLessThanOrEqual(4);
    expect(speechVoiceForSessionToken(token)).toBe(voice);
    expect(
      speechVoiceForSessionToken(`${token}-different`),
    ).toBeGreaterThanOrEqual(0);
  });

  test("allows two utterances per session and replenishes one every two seconds", () => {
    const limiter = new SpeechRateLimiter();
    expect(limiter.accept("session", 1_000)).toEqual({
      accepted: true,
      retryAfterMs: 0,
    });
    expect(limiter.accept("session", 1_000)).toEqual({
      accepted: true,
      retryAfterMs: 0,
    });
    expect(limiter.accept("session", 1_000)).toEqual({
      accepted: false,
      retryAfterMs: 2_000,
    });
    expect(limiter.accept("session", 2_999)).toEqual({
      accepted: false,
      retryAfterMs: 1,
    });
    expect(limiter.accept("session", 3_000)).toEqual({
      accepted: true,
      retryAfterMs: 0,
    });
  });

  test("caps aggregate speech at eight utterances and replenishes four per second", () => {
    const limiter = new SpeechRateLimiter();
    for (let index = 0; index < 8; index += 1)
      expect(limiter.accept(`session-${index}`, 1_000).accepted).toBeTrue();
    expect(limiter.accept("overflow", 1_000)).toEqual({
      accepted: false,
      retryAfterMs: 250,
    });
    expect(limiter.accept("overflow", 1_249)).toEqual({
      accepted: false,
      retryAfterMs: 1,
    });
    expect(limiter.accept("overflow", 1_250)).toEqual({
      accepted: true,
      retryAfterMs: 0,
    });
  });

  test("forgetting an expired session resets only its private bucket", () => {
    const limiter = new SpeechRateLimiter();
    expect(limiter.accept("session", 1_000).accepted).toBeTrue();
    expect(limiter.accept("session", 1_000).accepted).toBeTrue();
    limiter.forget("session");
    expect(limiter.accept("session", 1_000).accepted).toBeTrue();
  });
});
