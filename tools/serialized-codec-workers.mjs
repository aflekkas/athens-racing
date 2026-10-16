// three's codec loaders serialize functions into Blob workers. Freeze their unminified
// source before esbuild can rename closure variables or inject keepNames helpers.
import { runInNewContext } from 'node:vm';
import { pathToFileURL } from 'node:url';
export async function preserveCodecWorkerSource(path, source) {
  if (path.endsWith('/KTX2Loader.js')) {
    const expression = 'KTX2Loader.BasisWorker.toString()', assignment = 'KTX2Loader.BasisWorker = function';
    if (!source.includes(expression) || !source.includes(assignment)) throw new Error('KTX2 worker serialization changed; review the pinned three loader');
    const { KTX2Loader } = await import(pathToFileURL(path));
    const worker = KTX2Loader.BasisWorker.toString();
    // This private constructor property is otherwise retained as an unused second copy.
    const definition = 'KTX2Loader.BasisWorker = ' + worker + ';';
    if (!source.includes(definition)) throw new Error('KTX2 worker definition changed');
    return source.replace(expression, JSON.stringify(worker)).replace(definition, '');
  }
  if (path.endsWith('/meshopt_decoder.module.js')) {
    const expression = 'decode.toString() + workerProcess.toString()', anchor = 'ready: ready,';
    if (!source.includes(expression) || !source.includes(anchor)) throw new Error('Meshopt worker serialization changed; review the pinned three decoder');
    const capture = source.replace(anchor, anchor + ' __workerFunctions: { decode, workerProcess },').replace(/export\s*\{\s*MeshoptDecoder\s*\};?/, '');
    const decoder = runInNewContext(capture + '\nMeshoptDecoder;', {}, { timeout: 1000 });
    await decoder.ready;
    const { decode, workerProcess } = decoder.__workerFunctions;
    return source.replace(expression, JSON.stringify(decode.toString() + workerProcess.toString()));
  }
  return source;
}
