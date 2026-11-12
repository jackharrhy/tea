import {
  Input,
  ALL_FORMATS,
  BlobSource,
  AudioSampleSink,
  EncodedPacketSink,
  EncodedAudioPacketSource,
  StreamTarget,
  Output,
  Mp4OutputFormat,
  Mp4InputFormat,
  WebMOutputFormat,
  Conversion,
  Quality,
  canEncodeAudio,
  canEncodeVideo,
  type InputAudioTrack,
} from "mediabunny";
import { registerAacEncoder } from "@mediabunny/aac-encoder";
import {
  videoBudget,
  conversionAdvice,
  supportedVideoBitrate,
  calibratedVideoBitrate,
  encoderRateStalled,
  automaticDimensions,
  automaticAudioBitrate,
  fitDimensions,
  smallerDimensions,
} from "./domain.mjs";
import type { ExportOptions, MediaRequest, MediaResponse } from "./types";
const send = (message: MediaResponse) => postMessage(message);
let current: Conversion | undefined;
let cancelled = false;
const openInput = (file: File) =>
  new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
async function copyAudio(
  track: InputAudioTrack,
  start: number,
  end: number,
  add?: EncodedAudioPacketSource,
) {
  const sink = new EncodedPacketSink(track);
  const first = (await sink.getPacket(start)) ?? (await sink.getFirstPacket());
  if (!first) return 0;
  let bytes = 0;
  const config = add ? await track.getDecoderConfig() : null;
  for await (const packet of sink.packets(first)) {
    if (cancelled) throw new Error("Cancelled");
    if (packet.timestamp >= end) break;
    if (packet.timestamp + packet.duration <= start) continue;
    bytes += packet.byteLength;
    // Keep the full encoded boundary packet. MP4 edit lists hide its negative timestamp.
    if (add)
      await add.add(
        packet.clone({
          timestamp: packet.timestamp - start,
          duration: Math.min(packet.duration, end - packet.timestamp),
        }),
        config ? { decoderConfig: config } : undefined,
      );
  }
  return bytes;
}
async function inspect(file: File) {
  const input = openInput(file);
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error("No readable video track.");
    const audio = await input.getPrimaryAudioTrack();
    const duration =
      (await input.getDurationFromMetadata()) ??
      (await input.computeDuration());
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error(
        "The file has no finite video duration. Choose another video.",
      );
    const stats = audio ? await audio.computePacketStats(100) : null;
    send({
      type: "metadata",
      metadata: {
        duration,
        width: video.displayWidth,
        height: video.displayHeight,
        audioCodec: audio?.codec ?? null,
        audioBitrate: stats?.averageBitrate ?? 0,
        videoCodec: video.codec,
        decodable: await video.canDecode(),
      },
    });
    if (!audio) {
      send({ type: "waveform-status", text: "No audio track." });
      return;
    }
    if (!(await audio.canDecode())) {
      send({
        type: "waveform-status",
        text: "Cannot display a waveform for this audio codec.",
      });
      return;
    }
    const peaks = new Float32Array(1200);
    let samples = 0;
    for await (const sample of new AudioSampleSink(audio).samples()) {
      try {
        const data = new Float32Array(sample.numberOfFrames);
        sample.copyTo(data, { planeIndex: 0, format: "f32-planar" });
        for (let i = 0; i < data.length; i += 32) {
          const bin = Math.floor(
            ((sample.timestamp + i / sample.sampleRate) / duration) *
              peaks.length,
          );
          if (bin >= 0 && bin < peaks.length)
            peaks[bin] = Math.max(peaks[bin], Math.abs(data[i]));
        }
      } finally {
        sample.close();
      }
      if (++samples % 400 === 0)
        send({ type: "waveform", peaks: Array.from(peaks) });
    }
    send({ type: "waveform", peaks: Array.from(peaks) });
    send({
      type: "waveform-status",
      text: "",
    });
  } finally {
    input.dispose();
  }
}
class OutputTooLarge extends Error {}
type Rendered = {
  blob: Blob;
  temporary?: string;
  width: number;
  height: number;
};
async function encode(file: File, options: ExportOptions) {
  const input = openInput(file);
  let directory: FileSystemDirectoryHandle | undefined;
  let best: Rendered | undefined;
  const release = async (result: Rendered) => {
    if (result.temporary)
      await directory?.removeEntry(result.temporary).catch(() => {});
  };
  const deliver = (result: Rendered) =>
    send({
      type: "done",
      ...result,
      name: `${file.name.replace(/\.[^.]+$/, "")}-clip.${options.format}`,
    });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode()))
      throw new Error(
        `This browser cannot read this video codec. ${conversionAdvice(file.size)}`,
      );
    const totalDuration =
      (await input.getDurationFromMetadata()) ??
      (await input.computeDuration());
    const { start, end, target, format, audio: audioMode, crop } = options;
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end > totalDuration + 0.05 ||
      end - start < 0.05
    )
      throw new Error(
        "Choose a clip range within the video, at least 0.05 seconds long.",
      );
    const duration = end - start;
    const audio = await input.getPrimaryAudioTrack();
    if (
      options.automatic &&
      format === "mp4" &&
      !crop &&
      !options.fps &&
      start === 0 &&
      Math.abs(end - totalDuration) < 0.001 &&
      file.size < target * 1048576 &&
      track.codec === "avc" &&
      (!audio || audio.codec === "aac") &&
      audioMode !== "mute" &&
      (await input.getFormat()) instanceof Mp4InputFormat
    ) {
      send({
        type: "done",
        blob: file,
        name: file.name,
        width: track.displayWidth,
        height: track.displayHeight,
        unchanged: true,
      });
      return;
    }
    const codec = format === "mp4" ? "avc" : "vp9";
    const outputFormat =
      format === "mp4"
        ? new Mp4OutputFormat({ fastStart: "fragmented" })
        : new WebMOutputFormat();
    if (
      audioMode === "keep" &&
      audio &&
      !outputFormat.getSupportedAudioCodecs().includes(audio.codec!)
    )
      throw new Error(
        "The original audio codec cannot be used in this format. Compress audio or choose MP4.",
      );
    if (audioMode === "keep" && audio && format === "webm" && start > 0)
      throw new Error(
        "Choose MP4 to keep original audio with a trimmed start.",
      );
    const audioBitrate = options.automatic
      ? automaticAudioBitrate(target * 1048576, duration)
      : 128000;
    let audioBytes = 0;
    if (audio && audioMode === "keep") {
      send({
        type: "progress",
        progress: 0,
        text: "Measuring original audio…",
      });
      audioBytes = await copyAudio(audio, start, end);
    } else if (audio && audioMode === "compress")
      audioBytes = (audioBitrate * duration) / 8;
    const { bytes: limit, bitrate: budgetBitrate } = videoBudget(
      target,
      duration,
      audioBytes,
    );
    const limitLabel = `${limit / 1e6} MB`;
    const sourceW = crop?.width ?? track.displayWidth;
    const sourceH = crop?.height ?? track.displayHeight;
    let dimensions = fitDimensions(
      sourceW,
      sourceH,
      options.height ? options.height / sourceH : 1,
    );
    if (options.automatic) {
      send({
        type: "progress",
        progress: 0,
        text: `Choosing a resolution for ${limitLabel}…`,
      });
      const metrics = await track.computeFrameRateMetrics({
        targetPacketCount: 128,
      });
      dimensions = automaticDimensions(
        dimensions.width,
        dimensions.height,
        budgetBitrate,
        options.fps || metrics.averageFrameRate,
      );
    }
    if (
      format === "mp4" &&
      audioMode === "compress" &&
      audio &&
      !(await canEncodeAudio("aac"))
    )
      registerAacEncoder();

    async function render(
      width: number,
      height: number,
      bitrate: number,
      reason: string,
    ): Promise<Rendered> {
      let temporary: string | undefined;
      let stream: FileSystemWritableFileStream | undefined;
      let handle: FileSystemFileHandle | undefined;
      let output: Output | undefined;
      let size = 0,
        memoryBytes = 0;
      const chunks: { position: number; data: Uint8Array<ArrayBuffer> }[] = [];
      try {
        if (limit > 64 * 1024 * 1024) {
          if (!navigator.storage?.getDirectory)
            throw new Error(
              "Exports above 64 MiB need browser private file storage.",
            );
          directory = await navigator.storage.getDirectory();
          temporary = `8mb-${crypto.randomUUID()}.tmp`;
          handle = await directory.getFileHandle(temporary, { create: true });
          stream = await handle.createWritable();
        }
        output = new Output({
          format: outputFormat,
          target: new StreamTarget(
            new WritableStream({
              write: async (chunk) => {
                size = Math.max(size, chunk.position + chunk.data.length);
                if (stream) await stream.write(chunk);
                else {
                  memoryBytes += chunk.data.length;
                  const ceiling = limit * 2 + 16 * 1024 * 1024;
                  if (size > ceiling || memoryBytes > ceiling * 2)
                    throw new OutputTooLarge(
                      "The encoder exceeded the output buffer limit. Choose Automatic resolution to fit this clip.",
                    );
                  chunks.push({
                    position: chunk.position,
                    data: chunk.data.slice(),
                  });
                }
              },
            }),
          ),
        });
        let copied: EncodedAudioPacketSource | undefined;
        if (audio && audioMode === "keep") {
          copied = new EncodedAudioPacketSource(audio.codec!);
          output.addAudioTrack(copied);
        }
        let lastPreview = -Infinity;
        const previewScale = Math.min(240 / width, 160 / height);
        const canvas = new OffscreenCanvas(
          Math.max(1, Math.round(width * previewScale)),
          Math.max(1, Math.round(height * previewScale)),
        );
        const context = canvas.getContext("2d");
        let previewEnabled =
          !!options.preview &&
          !!context &&
          (width !== track!.displayWidth ||
            height !== track!.displayHeight ||
            !!crop);
        current = await Conversion.init({
          input,
          output,
          tracks: "primary",
          composable: true,
          trim: { start, end },
          video: {
            codec,
            quality: new Quality({ bitrate }),
            forceTranscode: true,
            width,
            height,
            fit: "fill",
            crop,
            frameRate: options.fps || undefined,
            process: previewEnabled
              ? (sample) => {
                  if (
                    previewEnabled &&
                    performance.now() - lastPreview > 1800
                  ) {
                    lastPreview = performance.now();
                    try {
                      context!.drawImage(
                        sample.toCanvasImageSource(),
                        0,
                        0,
                        canvas.width,
                        canvas.height,
                      );
                      const bitmap = canvas.transferToImageBitmap();
                      postMessage(
                        {
                          type: "encoding-frame",
                          bitmap,
                          time: start + sample.timestamp,
                        },
                        { transfer: [bitmap] },
                      );
                    } catch (error) {
                      previewEnabled = false;
                      console.warn("Encoding preview unavailable", error);
                    }
                  }
                  return sample;
                }
              : undefined,
          },
          audio:
            audioMode === "compress"
              ? {
                  codec: format === "mp4" ? "aac" : "opus",
                  quality: new Quality({ bitrate: audioBitrate }),
                  forceTranscode: true,
                }
              : { discard: true },
          showWarnings: false,
        });
        const discarded = current.discardedTracks.filter(
          (x) =>
            x.track.isVideoTrack() ||
            (audioMode === "compress" && x.track.isAudioTrack()),
        );
        if (!current.isValid || discarded.length)
          throw new Error(
            `The browser could not encode these settings. ${conversionAdvice(file.size)}`,
          );
        current.onProgress = (progress) =>
          send({
            type: "progress",
            progress,
            text: `${reason} · ${width} × ${height} · ${Math.round(progress * 100)}%`,
          });
        await output.start();
        await Promise.all([
          current.execute(),
          (async () => {
            if (copied && audio) {
              await copyAudio(audio, start, end, copied);
              copied.close();
            }
          })(),
        ]);
        if (cancelled) throw new Error("Cancelled");
        await output.finalize();
        if (stream) {
          await stream.close();
          stream = undefined;
        }
        let blob: Blob;
        if (handle) blob = await handle.getFile();
        else {
          const buffer = new Uint8Array(size);
          for (const chunk of chunks) buffer.set(chunk.data, chunk.position);
          chunks.length = 0;
          blob = new Blob([buffer], {
            type: format === "mp4" ? "video/mp4" : "video/webm",
          });
        }
        const result = { blob, temporary, width, height };
        temporary = undefined;
        return result;
      } finally {
        await stream?.abort().catch(() => {});
        if (output && output.state !== "finalized")
          await output.cancel().catch(() => {});
        if (temporary) await directory?.removeEntry(temporary).catch(() => {});
      }
    }

    let bitrate = budgetBitrate;
    let qualityPassUsed = false;
    let reason = "Encoding";
    let previousOversize: { bitrate: number; size: number } | undefined;
    const passes = options.automatic ? 8 : 4;
    for (let pass = 1; pass <= passes; pass++) {
      if (cancelled) throw new Error("Cancelled");
      const { width, height } = dimensions;
      const supports = (rate: number) =>
        canEncodeVideo(codec, {
          width,
          height,
          quality: new Quality({ bitrate: rate }),
          frameRate: options.fps || undefined,
        });
      const supported = await supportedVideoBitrate(bitrate, supports);
      let result: Rendered | undefined;
      let resize = supported === null;
      if (!resize) {
        bitrate = supported!;
        send({
          type: "progress",
          progress: 0,
          text: `Pass ${pass} · ${width} × ${height} · starting…`,
        });
        try {
          result = await render(width, height, bitrate, reason);
        } catch (error) {
          if (options.automatic && error instanceof OutputTooLarge)
            resize = true;
          else throw error;
        }
      }
      if (result) {
        const size = result.blob.size;
        if (size < limit) {
          const higher =
            !qualityPassUsed && pass < passes
              ? calibratedVideoBitrate(bitrate, size, limit, audioBytes)
              : null;
          qualityPassUsed = true;
          if (higher && (await supports(higher))) {
            best = result;
            reason = "Improving quality";
            bitrate = higher;
            send({
              type: "progress",
              progress: 0,
              text: `${(size / 1e6).toFixed(2)} MB fits. Improving quality…`,
            });
            continue;
          }
          deliver(result);
          return;
        }
        await release(result);
        if (best) {
          deliver(best);
          best = undefined;
          return;
        }
        resize = !!encoderRateStalled(previousOversize, bitrate, size);
        previousOversize = { bitrate, size };
        if (!resize) {
          bitrate = Math.floor(
            bitrate *
              Math.max(
                0.25,
                (limit * 0.94 - audioBytes) / Math.max(1, size - audioBytes),
              ),
          );
          if (bitrate < 10000) resize = true;
          else {
            reason = "Adjusting quality";
            send({
              type: "progress",
              progress: 0,
              text: `${(size / 1e6).toFixed(2)} MB is too large. Adjusting quality…`,
            });
          }
        }
      }
      if (resize) {
        const next = options.automatic
          ? smallerDimensions(width, height, pass >= passes - 2 ? 0 : 0.75)
          : null;
        if (!next)
          throw new Error(
            options.automatic
              ? "This clip cannot fit at a usable resolution. Trim a shorter selection."
              : "These fixed settings do not fit. Choose Automatic resolution or a shorter clip.",
          );
        reason = "Reducing resolution";
        dimensions = next;
        bitrate = budgetBitrate;
        previousOversize = undefined;
        send({
          type: "progress",
          progress: 0,
          text: `Reducing to ${next.width} × ${next.height} to fit ${limitLabel}…`,
        });
      }
    }
    throw new Error(
      "This clip is too long to fit at a usable quality. Trim a shorter selection and try again.",
    );
  } catch (error) {
    if (!best || cancelled) throw error;
    deliver(best);
    best = undefined;
  } finally {
    if (best) await release(best);
    input.dispose();
    current = undefined;
  }
}
self.addEventListener("message", async (event: MessageEvent<MediaRequest>) => {
  const message = event.data;
  if (message.type === "cancel") {
    cancelled = true;
    await current?.cancel();
    return;
  }
  if (message.type === "cleanup") {
    await navigator.storage
      .getDirectory()
      .then((d) => d.removeEntry(message.name))
      .catch(() => {});
    return;
  }
  cancelled = false;
  try {
    if (message.type === "inspect") await inspect(message.file);
    else await encode(message.file, message.options);
  } catch (error) {
    if (cancelled) send({ type: "cancelled" });
    else
      send({
        type: "error",
        text: error instanceof Error ? error.message : String(error),
      });
  }
});
