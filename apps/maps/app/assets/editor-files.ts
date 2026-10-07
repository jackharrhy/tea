import { mapSourceFingerprint } from "@tea/maps-editor/core";

export interface MapFileHandle {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: Blob | string): Promise<void>;
    close(): Promise<void>;
    abort?(): Promise<void>;
  }>;
}

interface MapPickerWindow extends Window {
  showOpenFilePicker?: (options: object) => Promise<readonly MapFileHandle[]>;
  showSaveFilePicker?: (options: object) => Promise<MapFileHandle>;
}

const fileTypes = [
  { description: "Quake map source", accept: { "text/plain": [".map"] } },
];

export async function pickMapFile(): Promise<MapFileHandle | null> {
  const picker = (window as MapPickerWindow).showOpenFilePicker;
  if (!picker) return null;
  const [handle] = await picker({ multiple: false, types: fileTypes });
  return handle ?? null;
}

export async function pickMapSaveFile(
  name: string,
): Promise<MapFileHandle | null> {
  const picker = (window as MapPickerWindow).showSaveFilePicker;
  if (!picker) return null;
  return picker({ suggestedName: name, types: fileTypes });
}

export function supportsMapOpenPicker(): boolean {
  return !!(window as MapPickerWindow).showOpenFilePicker;
}

export function supportsMapSavePicker(): boolean {
  return !!(window as MapPickerWindow).showSaveFilePicker;
}

export async function writeMapFile(
  handle: MapFileHandle,
  source: string,
  expectedFingerprint?: string,
): Promise<string> {
  if (expectedFingerprint !== undefined) {
    const current = await handle.getFile();
    if (mapSourceFingerprint(await current.text()) !== expectedFingerprint) {
      throw new Error(
        "The map changed on disk. Open it again or download a copy before saving.",
      );
    }
  }
  const writable = await handle.createWritable();
  try {
    await writable.write(new Blob([source], { type: "text/plain" }));
    await writable.close();
  } catch (error) {
    await writable.abort?.().catch(() => undefined);
    throw error;
  }
  return mapSourceFingerprint(source);
}

export function downloadMapCopy(name: string, source: string): void {
  const url = URL.createObjectURL(new Blob([source], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
