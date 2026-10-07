export interface RoomPreset {
  readonly dry: number;
  readonly wet: number;
  readonly duration: number;
  readonly decay: number;
  readonly lowpass: number;
  readonly delay: number;
  readonly delayWet: number;
  readonly feedback: number;
}

const OFF_ROOM: RoomPreset = {
  dry: 1,
  wet: 0,
  duration: 0.05,
  decay: 1,
  lowpass: 20_000,
  delay: 0,
  delayWet: 0,
  feedback: 0,
};

/** Approximate the character of GoldSrc's numbered room families without copying its DSP mixer. */
export function roomPresetForType(roomType: number): RoomPreset {
  if (roomType <= 0 || roomType > 28) return OFF_ROOM;
  const variation = (roomType - 1) % 3;
  if (roomType <= 4) {
    return {
      dry: 0.88,
      wet: 0.12 + variation * 0.04,
      duration: 0.45 + variation * 0.18,
      decay: 2.5,
      lowpass: 9_000,
      delay: 0.02 + variation * 0.012,
      delayWet: 0.08,
      feedback: 0.3 + variation * 0.08,
    };
  }
  if (roomType <= 7) {
    return {
      dry: 0.76,
      wet: 0.3,
      duration: 1.3 + variation * 0.45,
      decay: 2.1,
      lowpass: 6_800,
      delay: 0.07 + variation * 0.04,
      delayWet: 0.2,
      feedback: 0.48 + variation * 0.08,
    };
  }
  if (roomType <= 10) {
    return {
      dry: 0.78,
      wet: 0.26,
      duration: 0.9 + variation * 0.35,
      decay: 2.6,
      lowpass: 8_500,
      delay: 0.025 + variation * 0.02,
      delayWet: 0.12,
      feedback: 0.34,
    };
  }
  if (roomType <= 13) {
    return {
      dry: 0.82,
      wet: 0.24,
      duration: 0.65 + variation * 0.22,
      decay: 1.7,
      lowpass: 15_000,
      delay: 0.018,
      delayWet: 0.08,
      feedback: 0.25,
    };
  }
  if (roomType <= 16) {
    return {
      dry: 0.72,
      wet: 0.22,
      duration: 0.7 + variation * 0.25,
      decay: 1.9,
      lowpass: 900 - variation * 130,
      delay: 0.045 + variation * 0.05,
      delayWet: 0.16,
      feedback: 0.42,
    };
  }
  if (roomType <= 19) {
    return {
      dry: 0.8,
      wet: 0.25,
      duration: 0.8 + variation * 0.35,
      decay: 2.3,
      lowpass: 5_800,
      delay: 0.03 + variation * 0.035,
      delayWet: 0.12,
      feedback: 0.4,
    };
  }
  if (roomType <= 22) {
    return {
      dry: 0.92,
      wet: 0.06,
      duration: 0.3 + variation * 0.12,
      decay: 1.4,
      lowpass: 12_000,
      delay: 0.1 + variation * 0.05,
      delayWet: 0.08,
      feedback: 0.15,
    };
  }
  if (roomType <= 25) {
    return {
      dry: 0.7,
      wet: 0.38,
      duration: 1.8 + variation * 0.7,
      decay: 2.8,
      lowpass: 4_800,
      delay: 0.13 + variation * 0.07,
      delayWet: 0.2,
      feedback: 0.52,
    };
  }
  return {
    dry: 0.72,
    wet: 0.32,
    duration: 0.55 + variation * 0.45,
    decay: 1.2,
    lowpass: 3_200 + variation * 2_000,
    delay: 0.009 + variation * 0.09,
    delayWet: 0.24,
    feedback: 0.65,
  };
}
