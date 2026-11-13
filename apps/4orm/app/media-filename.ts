function fileParts(name: string) {
  const base = name.replace(/\/+$/, "").split("/").at(-1) ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 && dot < base.length - 1
    ? { stem: base.slice(0, dot), suffix: base.slice(dot) }
    : { stem: base, suffix: "" };
}

function cleanFilename(name: string) {
  const { stem, suffix } = fileParts(name || "file");
  const safe =
    stem.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^[-._]+|[-._]+$/g, "") ||
    "file";
  return safe + suffix.slice(0, 16).toLowerCase();
}

export function chosenFilename(chosen: string, original: string) {
  let filename = cleanFilename(chosen.trim() || original || "file");
  const ext = fileParts(original).suffix.toLowerCase();
  if (ext && fileParts(filename).suffix.toLowerCase() !== ext)
    filename = fileParts(filename).stem + ext;
  return filename;
}

export function numberedFilename(filename: string, number: number) {
  const { stem, suffix } = fileParts(filename);
  return `${stem}-${number}${suffix}`;
}
