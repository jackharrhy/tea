import type { SpeechVoice } from "@harrhy/gurgur-engine";

type LinTalkerModule = {
  HEAPU8: Uint8Array;
  HEAP16: Int16Array;
  _malloc(length: number): number;
  _free(pointer: number): void;
  _wt_init(): number;
  _wt_set_voice(voice: number): number;
  _wt_speak(pointer: number): number;
  _wt_get_buffer(): number;
  _wt_get_buffer_len(): number;
};

type LinTalkerFactory = (options: {
  locateFile(path: string): string;
}) => Promise<LinTalkerModule>;

type WorkerRequest = {
  type: "synthesize";
  generation: number;
  jobId: number;
  voice: SpeechVoice;
  text: string;
  scriptUrl: string;
  wasmUrl: string;
};

type WorkerResponse =
  | {
      type: "pcm";
      generation: number;
      jobId: number;
      sampleRate: 22_050;
      samples: ArrayBuffer;
    }
  | { type: "error"; generation: number; jobId: number; message: string };

declare const WinTalker: LinTalkerFactory;

const worker = globalThis as unknown as DedicatedWorkerGlobalScope;
let modulePromise: Promise<LinTalkerModule> | null = null;
const MAX_SAMPLES = 22_050 * 15;

worker.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  void synthesize(event.data);
});

async function synthesize(request: WorkerRequest): Promise<void> {
  try {
    const module = await loadModule(request.scriptUrl, request.wasmUrl);
    if (module._wt_set_voice(request.voice) !== 0)
      throw new Error("voice selection failed");
    const encoded = new TextEncoder().encode(request.text);
    const textPointer = module._malloc(encoded.length + 1);
    try {
      module.HEAPU8.set(encoded, textPointer);
      module.HEAPU8[textPointer + encoded.length] = 0;
      if (module._wt_speak(textPointer) !== 0)
        throw new Error("synthesis failed");
    } finally {
      module._free(textPointer);
    }
    const length = module._wt_get_buffer_len();
    const pointer = module._wt_get_buffer();
    if (length <= 0 || length > MAX_SAMPLES || pointer === 0)
      throw new Error(
        length > MAX_SAMPLES
          ? "speech exceeds 15 seconds"
          : "speech produced no audio",
      );
    const samples = new Int16Array(length);
    samples.set(new Int16Array(module.HEAP16.buffer, pointer, length));
    const response: WorkerResponse = {
      type: "pcm",
      generation: request.generation,
      jobId: request.jobId,
      sampleRate: 22_050,
      samples: samples.buffer,
    };
    worker.postMessage(response, [samples.buffer]);
  } catch (error) {
    const response: WorkerResponse = {
      type: "error",
      generation: request.generation,
      jobId: request.jobId,
      message: error instanceof Error ? error.message : "synthesis failed",
    };
    worker.postMessage(response, []);
  }
}

function loadModule(
  scriptUrl: string,
  wasmUrl: string,
): Promise<LinTalkerModule> {
  if (modulePromise) return modulePromise;
  worker.importScripts(scriptUrl);
  modulePromise = WinTalker({ locateFile: () => wasmUrl }).then((module) => {
    if (module._wt_init() !== 0)
      throw new Error("LinTalker initialization failed");
    return module;
  });
  return modulePromise;
}
