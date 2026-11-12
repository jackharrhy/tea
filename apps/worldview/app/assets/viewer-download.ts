export function viewerMapFilename(): string {
  return (
    document
      .querySelector<HTMLElement>("#map-name")
      ?.textContent?.replace(/\.bsp$/iu, "")
      .replace(/[^a-z0-9_-]+/giu, "-") || "map"
  );
}

export function downloadViewerFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
