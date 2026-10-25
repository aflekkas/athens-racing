import path from 'node:path';

// Lexical confinement for resolved absolute paths. Callers that accept symlinks
// must resolve them with realpath first; a string prefix cannot establish this.
export function pathIsWithin(root, candidate, paths = path) {
  if (typeof root !== 'string' || typeof candidate !== 'string' || root.includes('\0') || candidate.includes('\0') || !paths.isAbsolute(root) || !paths.isAbsolute(candidate)) return false;
  const relative = paths.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + paths.sep) && !paths.isAbsolute(relative);
}
