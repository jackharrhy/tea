export type BodyReadResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: "missing" | "too_large" | "unreadable" };

export async function readRequestBody(
  request: Request,
  options: { maxBytes: number; timeoutMs?: number },
): Promise<BodyReadResult> {
  const { maxBytes, timeoutMs } = options;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0)
    throw new RangeError("maxBytes must be a non-negative safe integer");

  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)
  ) {
    void request.body?.cancel().catch(() => {});
    return { ok: false, error: "too_large" };
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    if (!request.body) return { ok: false, error: "missing" };
    reader = request.body.getReader();
  } catch {
    return { ok: false, error: "unreadable" };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline =
    timeoutMs === undefined
      ? undefined
      : new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("deadline")), timeoutMs);
        });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const item = await (deadline
        ? Promise.race([reader.read(), deadline])
        : reader.read());
      if (item.done) break;
      size += item.value.byteLength;
      if (size > maxBytes) return { ok: false, error: "too_large" };
      chunks.push(item.value);
    }
  } catch {
    return { ok: false, error: "unreadable" };
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}
