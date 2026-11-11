export type Crop = { left: number; top: number; width: number; height: number };
export type Metadata = {
  duration: number;
  width: number;
  height: number;
  audioCodec: string | null;
  audioBitrate: number;
  videoCodec: string | null;
  decodable: boolean;
};
export type ExportOptions = {
  start: number;
  end: number;
  /** Worker budget in MiB; the UI converts from decimal MB. */
  target: number;
  format: "mp4" | "webm";
  audio: "compress" | "keep" | "mute";
  height: number;
  fps: number;
  crop?: Crop;
  automatic?: boolean;
  preview?: boolean;
};
export type MediaRequest =
  | { type: "inspect"; file: File }
  | { type: "export"; file: File; options: ExportOptions }
  | { type: "cancel" }
  | { type: "cleanup"; name: string };
export type MediaResponse =
  | { type: "metadata"; metadata: Metadata }
  | { type: "waveform"; peaks: number[] }
  | { type: "waveform-status"; text: string }
  | { type: "progress"; progress: number; text: string }
  | { type: "encoding-frame"; bitmap: ImageBitmap; time: number }
  | {
      type: "done";
      blob: Blob;
      name: string;
      temporary?: string;
      width?: number;
      height?: number;
      unchanged?: boolean;
    }
  | { type: "error"; text: string }
  | { type: "cancelled" };
