// V8's usedJSHeapSize includes garbage awaiting collection (especially after
// parsing a route and compiling shaders). Keep it as telemetry, never as a
// synchronous admission decision: the same retained world must admit regardless
// of when the browser chooses to collect. Stream/decode reservations have their
// own hard byte limits; this conservative inventory covers their resident data
// plus the scene and regional cache without increasing any resource budget.
export function worldResourceUsage({ scene, tileJS = 0, tileGPU = 0, regionalBytes = 0, width = 0, height = 0, heapBytes = 0 }) {
  const residentJSBytes = tileJS + scene.geometryBytes + scene.textureBytes + regionalBytes;
  return {
    residentJSBytes,
    jsBytes: Math.max(heapBytes, residentJSBytes),
    gpuBytes: scene.gpuBytes + tileGPU + width * height * 20 + 16 * 1024 * 1024,
  };
}
export const worldResourcesFit = (usage, limits) => usage.residentJSBytes <= limits.jsBytes && usage.gpuBytes <= limits.gpuBytes;
