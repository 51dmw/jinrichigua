// Shared .env loader for the scripts/* pipelines (hot-sync, collect).
// Keeps the original hot-sync semantics: KEY=VALUE lines only, comments and empty values skipped,
// and variables already present in process.env are never overwritten.
import { readFileSync, existsSync } from 'node:fs';

export function loadEnvFile(file, { missingMessage } = {}) {
  if (!existsSync(file)) throw new Error(missingMessage || `缺少 ${file}（参照 .env.example）`);
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith('#') && m[2] !== '' && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
