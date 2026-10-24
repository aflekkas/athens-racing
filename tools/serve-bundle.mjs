import {prepareBundleWorldAssets, bundleWorldSourceFromCatalogue, serveBundleWorldRequest} from './bundle-world-assets.mjs';
// Local production-assets host with the real multiplayer transport. No build step for npm start.
import { readBuiltCatalogue, createGameServer } from '../server/index.mjs';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
export async function serveBundle(root = resolve('.deploy/assets'), options = {}) {
  const app = await createGameServer({ root, ...options, builtCataloguePath: options.builtCataloguePath === undefined ? resolve(root, '..', 'catalogue.json') : options.builtCataloguePath });
  let worldAssets;
  const closeApp=app.close;
  app.close=async()=>{const errors=[];for(const close of [()=>worldAssets?.close(),()=>closeApp()]){try{await close();}catch(error){errors.push(error);}}if(errors.length)throw errors[0];};
  try {
    const catalogue=await readBuiltCatalogue(root,options.builtCataloguePath===undefined?resolve(root,'..','catalogue.json'):options.builtCataloguePath);
    const source=bundleWorldSourceFromCatalogue(catalogue,app.routeConfig);
    if(source)worldAssets=await prepareBundleWorldAssets(source);
  const listeners = app.server.listeners('request'); app.server.removeAllListeners('request');
  const compressed = new Map();
  app.server.on('request', async (req, res) => {
    if(await serveBundleWorldRequest(worldAssets,req,res))return;
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path !== '/sw.js' && !/^\/_c\/[a-f0-9]{16}\.[a-z0-9]+$/.test(path) && !/^\/(?:src|assets|data)\/[a-zA-Z0-9_/-]+\.(?:js|css|json|svg)$/.test(path) && path !== '/style.css') {
      for (const listener of listeners) listener(req, res); return;
    }
    try {
      const file = resolve(root, '.' + path), info = await stat(file);
      const type = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[extname(file)] || 'application/octet-stream';
      if (/\.(js|css|json|svg)$/.test(path) && req.headers['accept-encoding']?.includes('gzip')) {
        let cached = compressed.get(file);
        const stamp = `${info.mtimeMs}:${info.size}`;
        if (!cached || cached.stamp !== stamp) { const body = gzipSync(await readFile(file)); cached = { body, stamp, etag: '"' + createHash('sha256').update(body).digest('hex').slice(0, 16) + '"' }; compressed.set(file, cached); }
        const headers = { 'Content-Type': type, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', ETag: cached.etag, 'Cache-Control': path === '/sw.js' ? 'no-cache' : 'public, max-age=31536000, immutable' };
        if (req.headers['if-none-match'] === cached.etag) { res.writeHead(304, headers); res.end(); return; }
        res.writeHead(200, { ...headers, 'Content-Length': cached.body.length }); res.end(cached.body); return;
      }
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': info.size, 'Cache-Control': path === '/sw.js' ? 'no-cache' : 'public, max-age=31536000, immutable' });
      createReadStream(file).pipe(res);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(done => app.server.listen(options.port || 0, '127.0.0.1', done));
  return { ...app, worldAssets, url: `http://127.0.0.1:${app.server.address().port}` };
  } catch(error) {if(error.cleanupError)try{console.error('Secondary world preparation cleanup failure:',error.cleanupError.message);}catch{}try{await app.close();}catch(secondary){try{console.error('Secondary bundle host cleanup failure:',secondary.message);}catch{}}throw error;}
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const app = await serveBundle(resolve(process.argv[2] || '.deploy/assets'), { port: Number(process.env.PORT || 8001) });
  console.log(app.url);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close().then(() => process.exit(0)));
}
