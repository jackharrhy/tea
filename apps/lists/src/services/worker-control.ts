export class ShutdownInterruptedError extends Error {
  constructor(message = "Work interrupted by application shutdown") {
    super(message);
    this.name = "ShutdownInterruptedError";
  }
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new ShutdownInterruptedError();
}

export async function abortableSleep(
  milliseconds: number,
  signal?: AbortSignal,
) {
  if (!signal) {
    await Bun.sleep(milliseconds);
    return;
  }
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", done);
      resolve();
    }
  });
}
