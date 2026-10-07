const CACHE_NAME = "ref-board-images-v1";
const MAX_SIDE = 1024;
const queue = [];
let busy = false;

self.addEventListener("message", (event) => {
  const source = event.data;
  if (typeof source !== "string" || !/^\/(?:media|previews)\//.test(source))
    return;
  queue.push(source);
  if (!busy) void processQueue();
});

async function processQueue() {
  busy = true;
  while (queue.length) {
    const source = queue.shift();
    try {
      const response = await fetch(source, { credentials: "same-origin" });
      if (!response.ok) throw new Error("Image unavailable");
      const type = response.headers.get("Content-Type")?.split(";", 1)[0];
      if (
        type !== "image/jpeg" &&
        type !== "image/png" &&
        type !== "image/webp"
      )
        throw new Error("Image type unsupported");
      const original = await response.blob();
      if (type === "image/webp") {
        const header = new Uint8Array(
          await original.slice(0, 21).arrayBuffer(),
        );
        const extended =
          String.fromCharCode(...header.slice(12, 16)) === "VP8X";
        if (extended && header[20] & 0x02) throw new Error("Animated image");
      }
      const bitmap = await createImageBitmap(original);
      let result = original;
      try {
        if (Math.max(bitmap.width, bitmap.height) > MAX_SIDE) {
          const factor = MAX_SIDE / Math.max(bitmap.width, bitmap.height);
          const width = Math.max(1, Math.round(bitmap.width * factor));
          const height = Math.max(1, Math.round(bitmap.height * factor));
          const canvas = new OffscreenCanvas(width, height);
          canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
          result = await canvas.convertToBlob({
            type: "image/webp",
            quality: 0.82,
          });
        }
      } finally {
        bitmap.close();
      }
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(
          source,
          new Response(result, { headers: { "Content-Type": result.type } }),
        );
      } catch {}
      // eslint-disable-next-line unicorn/require-post-message-target-origin
      self.postMessage({ source, image: result });
    } catch {
      // eslint-disable-next-line unicorn/require-post-message-target-origin
      self.postMessage({ source, image: null });
    }
  }
  busy = false;
}
