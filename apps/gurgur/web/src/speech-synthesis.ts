import type {
  RuntimeId,
  SpeechMessage,
  SpeechVoice,
} from "@harrhy/gurgur-engine";

type SpeechJob = {
  jobId: number;
  generation: number;
  speakerId: RuntimeId;
  voice: SpeechVoice;
  text: string;
};

type WorkerResponse =
  | {
      type: "pcm";
      generation: number;
      jobId: number;
      sampleRate: number;
      samples: ArrayBuffer;
    }
  | { type: "error"; generation: number; jobId: number; message: string };

export type SynthesizedSpeech = {
  speakerId: RuntimeId;
  sampleRate: number;
  samples: Int16Array;
};

export class SpeechSynthesizer {
  readonly #createWorker: () => Worker;
  #worker: Worker | null = null;
  readonly #scriptUrl: string;
  readonly #wasmUrl: string;
  readonly #onSpeech: (speech: SynthesizedSpeech) => void;
  readonly #queue: SpeechJob[] = [];
  #active: SpeechJob | null = null;
  #generation = 0;
  #nextJobId = 0;
  #disposed = false;

  constructor(options: {
    workerUrl: string;
    scriptUrl: string;
    wasmUrl: string;
    onSpeech(speech: SynthesizedSpeech): void;
    worker?: Worker;
  }) {
    this.#scriptUrl = options.scriptUrl;
    this.#wasmUrl = options.wasmUrl;
    this.#onSpeech = options.onSpeech;
    this.#createWorker = options.worker
      ? () => options.worker!
      : () => new Worker(options.workerUrl, { name: "gurgur-speech" });
  }

  enqueue(message: SpeechMessage): void {
    if (this.#disposed) return;
    if (this.#queue.length >= 8) this.#queue.shift();
    this.#queue.push({
      jobId: this.#nextJobId++,
      generation: this.#generation,
      speakerId: message.speakerId,
      voice: message.voice,
      text: message.text,
    });
    this.#startNext();
  }

  reset(): void {
    this.#generation += 1;
    this.#queue.length = 0;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#generation += 1;
    this.#queue.length = 0;
    this.#worker?.removeEventListener("message", this.#message);
    this.#worker?.removeEventListener("error", this.#error);
    this.#worker?.terminate();
    this.#worker = null;
    this.#active = null;
  }

  readonly #message = (event: MessageEvent<WorkerResponse>): void => {
    const active = this.#active;
    if (!active || event.data.jobId !== active.jobId) return;
    this.#active = null;
    if (
      event.data.type === "pcm" &&
      event.data.generation === this.#generation &&
      active.generation === this.#generation
    ) {
      this.#onSpeech({
        speakerId: active.speakerId,
        sampleRate: event.data.sampleRate,
        samples: new Int16Array(event.data.samples),
      });
    }
    this.#startNext();
  };

  readonly #error = (): void => {
    this.#active = null;
    this.#startNext();
  };

  #startNext(): void {
    if (this.#disposed || this.#active) return;
    const job = this.#queue.shift();
    if (!job) return;
    this.#active = job;
    this.#ensureWorker().postMessage(
      {
        type: "synthesize",
        generation: job.generation,
        jobId: job.jobId,
        voice: job.voice,
        text: job.text,
        scriptUrl: this.#scriptUrl,
        wasmUrl: this.#wasmUrl,
      },
      [],
    );
  }

  #ensureWorker(): Worker {
    if (this.#worker) return this.#worker;
    const worker = this.#createWorker();
    worker.addEventListener("message", this.#message);
    worker.addEventListener("error", this.#error);
    this.#worker = worker;
    return worker;
  }
}
