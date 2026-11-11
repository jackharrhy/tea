import { describe, expect, test } from "bun:test";
import { PROTOCOL_VERSION, type SpeechMessage } from "@harrhy/gurgur-engine";
import {
  SpeechSynthesizer,
  type SynthesizedSpeech,
} from "../../web/src/speech-synthesis";

type PostedJob = {
  type: "synthesize";
  generation: number;
  jobId: number;
  voice: number;
  text: string;
  scriptUrl: string;
  wasmUrl: string;
};

class FakeWorker extends EventTarget {
  readonly posted: PostedJob[] = [];
  terminated = false;

  postMessage(message: PostedJob): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(job: PostedJob, samples = new Int16Array([1, -2, 3])): void {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "pcm",
          generation: job.generation,
          jobId: job.jobId,
          sampleRate: 22_050,
          samples: samples.buffer,
        },
      }),
    );
  }
}

const message = (requestId: number): SpeechMessage => ({
  type: "speech",
  protocolVersion: PROTOCOL_VERSION,
  worldEpoch: 1,
  requestId,
  speakerId: { index: requestId + 1, generation: 1 },
  voice: (requestId % 5) as 0 | 1 | 2 | 3 | 4,
  text: `speech ${requestId}`,
});

function setup(): {
  worker: FakeWorker;
  output: SynthesizedSpeech[];
  synthesizer: SpeechSynthesizer;
} {
  const worker = new FakeWorker();
  const output: SynthesizedSpeech[] = [];
  const synthesizer = new SpeechSynthesizer({
    workerUrl: "/worker.js",
    scriptUrl: "/lintalker.js",
    wasmUrl: "/lintalker.wasm",
    onSpeech: (speech) => output.push(speech),
    worker: worker as unknown as Worker,
  });
  return { worker, output, synthesizer };
}

describe("speech synthesis queue", () => {
  test("keeps eight waiting jobs and discards the oldest unstarted job", () => {
    const { worker, output, synthesizer } = setup();
    for (let requestId = 0; requestId < 10; requestId += 1)
      synthesizer.enqueue(message(requestId));
    expect(worker.posted.map(({ jobId }) => jobId)).toEqual([0]);

    worker.reply(worker.posted[0]!);
    expect(worker.posted.map(({ jobId }) => jobId)).toEqual([0, 2]);
    expect(output).toHaveLength(1);
    expect(output[0]!.speakerId).toEqual({ index: 1, generation: 1 });
    synthesizer.dispose();
  });

  test("discards stale PCM after reset and transfers current PCM without copying its values", () => {
    const { worker, output, synthesizer } = setup();
    synthesizer.enqueue(message(0));
    const stale = worker.posted[0]!;
    synthesizer.reset();
    synthesizer.enqueue(message(1));
    worker.reply(stale, new Int16Array([8, 9]));
    expect(output).toHaveLength(0);
    expect(worker.posted).toHaveLength(2);
    expect(worker.posted[1]!.generation).toBe(1);

    worker.reply(worker.posted[1]!, new Int16Array([10, -11]));
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      speakerId: { index: 2, generation: 1 },
      sampleRate: 22_050,
    });
    expect([...output[0]!.samples]).toEqual([10, -11]);
    synthesizer.dispose();
    expect(worker.terminated).toBeTrue();
  });
});
