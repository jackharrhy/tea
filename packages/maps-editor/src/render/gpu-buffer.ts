/** Uploads immutable or infrequently replaced float data through WebGPU's portable queue path. */
export function uploadFloatBuffer(
  device: GPUDevice,
  data: Float32Array,
  usage: GPUBufferUsageFlags,
  label?: string,
): GPUBuffer {
  const buffer = device.createBuffer({
    ...(label ? { label } : {}),
    size: Math.max(4, (data.byteLength + 3) & ~3),
    usage: usage | GPUBufferUsage.COPY_DST,
  });
  if (data.byteLength > 0) device.queue.writeBuffer(buffer, 0, data);
  return buffer;
}
