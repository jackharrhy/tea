export function isAudioContextPaused(
  state: AudioContextState | string | undefined | null,
): boolean {
  return state === "suspended" || state === "interrupted";
}

class AudioContextManager {
  private context: AudioContext | null = null;
  private volumeGain: GainNode | null = null;
  private playbackGate: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private connectedMedia = new WeakSet<HTMLMediaElement>();

  getContext(): AudioContext {
    if (!this.context || this.context.state === "closed") {
      this.context = new AudioContext();
      this.volumeGain = this.context.createGain();
      this.playbackGate = this.context.createGain();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.minDecibels = -90;
      this.analyser.maxDecibels = -24;
      this.analyser.smoothingTimeConstant = 0.78;
      this.volumeGain.gain.value = 1;
      this.playbackGate.gain.value = 1;
      this.volumeGain.connect(this.playbackGate);
      this.playbackGate.connect(this.analyser);
      this.analyser.connect(this.context.destination);
    }
    return this.context;
  }

  getAnalyser(): AnalyserNode {
    if (!this.analyser) this.getContext();
    return this.analyser!;
  }

  async resume(): Promise<void> {
    let context = this.getContext();
    if (isAudioContextPaused(context.state)) await context.resume();
    await this.requestWakeLock();
  }

  setMasterGain(value: number, rampTime = 0.05): void {
    let context = this.getContext();
    let gain = this.volumeGain!;
    let clamped = Math.max(0, Math.min(1, value));
    gain.gain.cancelScheduledValues(context.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, context.currentTime);
    gain.gain.linearRampToValueAtTime(clamped, context.currentTime + rampTime);
  }

  muteNow(): void {
    let context = this.getContext();
    let gain = this.playbackGate!.gain;
    gain.cancelScheduledValues(context.currentTime);
    gain.setValueAtTime(0, context.currentTime);
  }

  scheduleAudibleAt(localEpochTime: number): number {
    let audioTime = this.localTimeToAudioTime(localEpochTime);
    let gain = this.playbackGate!.gain;
    gain.cancelScheduledValues(audioTime);
    gain.setValueAtTime(0, audioTime);
    gain.linearRampToValueAtTime(1, audioTime + 0.005);
    return audioTime;
  }

  scheduleMuteAt(localEpochTime: number): number {
    let audioTime = this.localTimeToAudioTime(localEpochTime);
    let gain = this.playbackGate!.gain;
    gain.cancelScheduledValues(audioTime);
    gain.setValueAtTime(gain.value, audioTime);
    gain.linearRampToValueAtTime(0, audioTime + 0.005);
    return audioTime;
  }

  outputLatencyMs(): number {
    return (this.getContext().outputLatency ?? 0) * 1000;
  }

  connectMediaElement(element: HTMLMediaElement): void {
    if (this.connectedMedia.has(element)) return;
    let source = this.getContext().createMediaElementSource(element);
    source.connect(this.volumeGain!);
    this.connectedMedia.add(element);
  }

  private localTimeToAudioTime(localEpochTime: number): number {
    let context = this.getContext();
    return localEpochToAudioTime(localEpochTime, {
      contextTime: context.currentTime,
      performanceNow: performance.now(),
      timeOrigin: performance.timeOrigin,
      outputLatencySeconds: context.outputLatency ?? 0,
      outputTimestamp: context.getOutputTimestamp?.(),
    });
  }

  private async requestWakeLock(): Promise<void> {
    if (this.wakeLock) return;
    try {
      if ("wakeLock" in navigator) {
        this.wakeLock = await navigator.wakeLock.request("screen");
        this.wakeLock.addEventListener("release", () => {
          this.wakeLock = null;
        });
      }
    } catch {
      // Best effort only.
    }
  }
}

export const audioContextManager = new AudioContextManager();
import { localEpochToAudioTime } from "./audio-timeline.ts";
