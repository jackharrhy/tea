export type WebGPUAdapterRequester = {
  requestAdapter(): Promise<unknown>;
};

export async function webGPUAvailable(
  gpu: WebGPUAdapterRequester | undefined,
): Promise<boolean> {
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}
