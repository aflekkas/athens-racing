// Offline build; dependencies and source licensing: tools/maps/attica/README.md.
import { spawnSync } from 'node:child_process';
const result = spawnSync(process.env.ATTICA_PYTHON || 'python3', [new URL('./build-attica-map.py', import.meta.url).pathname, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(result.status ?? 1);
