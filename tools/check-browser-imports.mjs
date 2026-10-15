// Resolve the source graph before bundling; native ESM remains the development path.
// Syntax-only checks miss imports of files accidentally omitted from a commit.
import { build } from 'esbuild';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/main.js', 'src/world-worker.js', 'src/ui/phone-wheel-controller.js'],
  outdir: '.scratch/import-check',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  external: ['three', 'three/*'],
  write: false,
  metafile: true,
  logLevel: 'error',
});
for (const file of Object.keys(result.metafile.inputs)) {
  if (!file.startsWith('src/')) throw new Error(`Browser import outside public src/: ${file}`);
}
console.log(`Browser import graph checked: ${Object.keys(result.metafile.inputs).length} modules.`);
