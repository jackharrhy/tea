import fs from "node:fs/promises";
import path from "node:path";

interface Notes {
  notes: Record<string, { note: string; updatedAt: string }>;
}
const file = path.resolve(".garden/compare-notes.json");
export async function readNotes(): Promise<Notes> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as Notes;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { notes: {} };
    throw error;
  }
}
export async function writeNote(page: string, note: string) {
  const notes = await readNotes();
  if (note.trim())
    notes.notes[page] = {
      note: note.trim(),
      updatedAt: new Date().toISOString(),
    };
  else delete notes.notes[page];
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(notes, null, 2) + "\n");
}
