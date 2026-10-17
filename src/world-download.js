// Retain completed small files and partial bodies across an interrupted map load.
// Packaging splits gzip streams; neither this transport nor retries alter geometry.
export class WorldDownloadError extends Error {
  constructor(code, message, asset = null) { super(message); this.name = 'WorldDownloadError'; this.code = code; this.asset = asset; }
}
export class WorldDownloads {
  constructor(paths, { assets = {}, totals = {}, onProgress = () => {}, idleMs = 30000, concurrency = 3 } = {}) {
    this.onProgress = onProgress; this.idleMs = idleMs; this.concurrency = concurrency; this.responseBytes = 0;
    this.groups = Object.fromEntries(Object.entries(paths).map(([kind, urls]) => [kind, (Array.isArray(urls) ? urls : [urls]).map(url => ({ kind, url, expected: assets[url], total: assets[url]?.bytes ?? null, received: 0, chunks: [], blob: null, reload: false }))]));
    // Interleave the streams instead of queuing every terrain part before roads.
    this.files = []; const groups = Object.values(this.groups);
    for (let i = 0; i < Math.max(...groups.map(g => g.length)); i++) for (const group of groups) if (group[i]) this.files.push(group[i]);
    this.totals = totals;
  }
  snapshot() {
    const known = this.files.every(file => Number.isFinite(file.total));
    const declared = Object.keys(this.groups).every(kind => Number.isFinite(this.totals[kind]));
    return { loadedBytes: this.files.reduce((sum, file) => sum + file.received, 0), totalBytes: declared ? Object.values(this.totals).reduce((a, b) => a + b, 0) : known ? this.files.reduce((sum, file) => sum + file.total, 0) : null, responseBytes: this.responseBytes };
  }
  reset(kind) {
    for (const file of this.groups[kind]) Object.assign(file, { received: 0, chunks: [], blob: null, total: file.expected?.bytes ?? null, reload: true });
    this.onProgress(this.snapshot());
  }
  blob(kind) { return new Blob(this.groups[kind].map(file => file.blob)); }
  release(kind) { for (const file of this.groups[kind]) { file.chunks = []; file.blob = null; file.decoded = true; } }
  async finish(file) {
    const blob = new Blob(file.chunks);
    if (file.expected?.sha256) {
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(v => v.toString(16).padStart(2, '0')).join('');
      if (digest !== file.expected.sha256) throw new WorldDownloadError('invalid', 'World file integrity failed', file.url);
    }
    file.blob = blob; file.chunks = []; this.onProgress({ ...this.snapshot(), asset: file.url });
  }
  async run() {
    const batch = new AbortController(); let next = 0, error;
    const offline = () => batch.abort(new WorldDownloadError('offline', 'The connection went offline'));
    globalThis.addEventListener?.('offline', offline);
    const lane = async () => {
      while (next < this.files.length && !batch.signal.aborted) {
        const file = this.files[next++]; if (file.blob || file.decoded) continue;
        try { await this.read(file, batch.signal); }
        catch (e) { if (!error) { error = e; batch.abort(e); } }
      }
    };
    try { await Promise.all(Array.from({ length: Math.min(this.concurrency, this.files.length) }, lane)); if (error) throw error; if (batch.signal.aborted) throw batch.signal.reason; }
    finally { globalThis.removeEventListener?.('offline', offline); }
  }
  async read(file, batchSignal) {
    const controller = new AbortController(); let timer, reader, response, cancellation;
    const abort = () => controller.abort(batchSignal.reason);
    const resetIdle = () => { clearTimeout(timer); timer = setTimeout(() => controller.abort(new WorldDownloadError('timeout', 'No world data arrived for 30 seconds', file.url)), this.idleMs); };
    batchSignal.addEventListener('abort', abort, { once: true });
    const cancelBody = () => {
      const stream = reader || response?.body;
      if (stream) cancellation ||= stream.cancel(controller.signal.reason).catch(() => {});
    };
    controller.signal.addEventListener('abort', cancelBody, { once: true });
    resetIdle();
    try {
      // A sibling may fail after our last byte but before EOF. Verify locally
      // instead of requesting an empty range, which some servers reject (416).
      if (file.total !== null && file.received === file.total) { await this.finish(file); return; }
      if (globalThis.navigator?.onLine === false) throw new WorldDownloadError('offline', 'The connection is offline', file.url);
      const offset = file.received;
      response = await fetch(file.url, { signal: controller.signal, cache: file.reload ? 'reload' : 'default', ...(offset ? { headers: { Range: `bytes=${offset}-` } } : {}) });
      controller.signal.throwIfAborted(); resetIdle();
      if (!response.ok) throw new WorldDownloadError('http', `World data HTTP ${response.status}`, file.url);
      const range = response.headers.get('Content-Range'), size = Number(response.headers.get('Content-Length'));
      let skip = offset;
      if (response.status === 206) {
        const parsed = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(range || '');
        if (!parsed || Number(parsed[1]) !== offset || Number(parsed[2]) < offset || Number(parsed[2]) >= Number(parsed[3]) || response.headers.has('Content-Length') && size !== Number(parsed[2]) - offset + 1) throw new WorldDownloadError('invalid', 'Invalid world data range', file.url);
        file.total = Number(parsed[3]); skip = 0;
      } else if (response.headers.has('Content-Length')) file.total = size;
      if (file.expected && file.total !== null && file.total !== file.expected.bytes) throw new WorldDownloadError('invalid', 'World file length changed', file.url);
      this.onProgress({ ...this.snapshot(), asset: file.url });
      if (!response.body) throw new WorldDownloadError('network', 'World response has no body', file.url);
      reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read(); controller.signal.throwIfAborted();
        if (done) break;
        if (value.byteLength) resetIdle(); this.responseBytes += value.byteLength;
        // Some CDNs ignore Range and return 200. Keep retained bytes and skip
        // the repeated prefix; new packages limit this replay to one small part.
        const ignored = Math.min(skip, value.byteLength); skip -= ignored;
        if (ignored < value.byteLength) { const chunk = value.subarray(ignored); file.chunks.push(chunk); file.received += chunk.byteLength; }
        if (file.received > (file.expected?.bytes ?? file.total ?? 25 * 1024 * 1024)) throw new WorldDownloadError('invalid', 'World file exceeds its declared size', file.url);
        this.onProgress({ ...this.snapshot(), asset: file.url });
      }
      if (skip || file.total !== null && file.received !== file.total) throw new WorldDownloadError('network', 'World response ended early', file.url);
      await this.finish(file);
    } catch (e) {
      if (controller.signal.aborted) throw controller.signal.reason;
      if (e.code === 'invalid') { file.chunks = []; file.received = 0; file.blob = null; file.total = file.expected?.bytes ?? null; file.reload = true; }
      const failure = e instanceof WorldDownloadError ? e : new WorldDownloadError(globalThis.navigator?.onLine === false ? 'offline' : 'network', e.message || 'World connection failed', file.url);
      // Header/size validation can fail before EOF (even before a reader exists).
      // Stop this response too: the lane's later batch abort only reaches siblings.
      controller.abort(failure);
      throw failure;
    } finally {
      clearTimeout(timer); batchSignal.removeEventListener('abort', abort);
      // Also catch a response delivered after cancellation, before acquiring its reader.
      if (controller.signal.aborted) { cancelBody(); await cancellation; }
      reader?.releaseLock();
    }
  }
}
export async function inflateWorldGzip(blob) {
  let stream;
  try { if (typeof DecompressionStream !== 'undefined') stream = new DecompressionStream('gzip'); } catch { /* Some implementations expose the API without gzip support. */ }
  if (stream) return new Response(blob.stream().pipeThrough(stream)).arrayBuffer();
  // Three already includes this MIT-licensed decoder. Older browsers can read
  // the exact same bake without running the expensive world generators.
  const { gunzipSync } = await import('three/addons/libs/fflate.module.js');
  await new Promise(resolve => setTimeout(resolve, 0));
  const compressed = new Uint8Array(await blob.arrayBuffer()), bytes = gunzipSync(compressed);
  // fflate's synchronous decoder does not check the gzip trailer. Keep the
  // native decoder's CRC/length guarantees on this compatibility path too.
  if (compressed.length < 18) throw new WorldDownloadError('invalid', 'Invalid gzip data');
  const footer = new DataView(compressed.buffer, compressed.byteOffset + compressed.length - 8, 8);
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let bit = 0; bit < 8; bit++) c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1; table[i] = c; }
  let crc = -1; for (const byte of bytes) crc = crc >>> 8 ^ table[(crc ^ byte) & 255];
  if ((crc ^ -1) >>> 0 !== footer.getUint32(0, true) || bytes.length >>> 0 !== footer.getUint32(4, true)) throw new WorldDownloadError('invalid', 'Invalid gzip checksum or length');
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
