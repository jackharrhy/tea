const assetFiles = ["public/styles.css", "public/app.js"];

async function contentVersion(): Promise<string> {
  if (process.env.ASSET_VERSION) return process.env.ASSET_VERSION;

  try {
    const contents = await Promise.all(
      assetFiles.map((path) => Bun.file(path).arrayBuffer()),
    );
    const totalLength = contents.reduce(
      (total, content) => total + content.byteLength,
      0,
    );
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const content of contents) {
      combined.set(new Uint8Array(content), offset);
      offset += content.byteLength;
    }
    const digest = await crypto.subtle.digest("SHA-256", combined);
    return Buffer.from(digest).toString("hex").slice(0, 12);
  } catch {
    return "dev";
  }
}

const assetVersion = await contentVersion();

export function assetUrl(path: string): string {
  return `${path}?v=${assetVersion}`;
}
