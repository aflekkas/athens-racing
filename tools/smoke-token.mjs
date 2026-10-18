import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
// The deploy smoke signs sessions with SMOKE_TOKEN: the environment wins, else the owner-only file the release train reads.
export const SMOKE_TOKEN_FILE = join(homedir(), '.config/athens-racing/smoke-token');
export function loadSmokeToken(env = process.env, file = SMOKE_TOKEN_FILE) {
  if (env.SMOKE_TOKEN) return env.SMOKE_TOKEN;
  try { return readFileSync(file, 'utf8').trim(); } catch { return ''; }
}
