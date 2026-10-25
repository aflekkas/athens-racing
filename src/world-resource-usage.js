// Admission charges retained world allocations and active decode reservations.
// Raw V8 heap also includes uncollected garbage; preserve it as telemetry only.
const validCount = value => Number.isSafeInteger(value) && value >= 0;
export function worldResourceUsage({ scene, tileJS = 0, tileGPU = 0, regionalBytes = 0, queryBytes = 0, transientBytes = 0, width = 0, height = 0, heapBytes = 0 }) {
  const sceneJSBytes = scene.geometryBytes + scene.textureBytes;
  const counts = [scene.geometryBytes, scene.textureBytes, scene.gpuBytes, tileJS, tileGPU, regionalBytes, queryBytes, transientBytes, width, height, heapBytes];
  if (!counts.every(validCount)) throw Error('Invalid world resource accounting');
  const residentJSBytes = sceneJSBytes + tileJS + regionalBytes + queryBytes + transientBytes;
  const gpuBytes = scene.gpuBytes + tileGPU + width * height * 20 + 16 * 1024 * 1024;
  if (!validCount(residentJSBytes) || !validCount(gpuBytes)) throw Error('Invalid world resource accounting');
  return { residentJSBytes, jsBytes: Math.max(heapBytes, residentJSBytes), gpuBytes, heapBytes,
    sceneJSBytes, tileJSBytes: tileJS, tileGPUBytes: tileGPU, regionalBytes, queryBytes, transientBytes };
}
export const worldResourcesFit = (usage, limits) => [usage.residentJSBytes, usage.gpuBytes, limits.jsBytes, limits.gpuBytes].every(validCount) && usage.residentJSBytes <= limits.jsBytes && usage.gpuBytes <= limits.gpuBytes;
