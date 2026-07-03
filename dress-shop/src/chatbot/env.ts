/** Minimal .env loader — no dependency needed for a demo. Reads dress-shop/.env. */
import fs from 'node:fs';

export function loadDotEnv(): void {
  try {
    const lines = fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n');
    for (const line of lines) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
    }
  } catch {
    // no .env — fine; the environment may already carry the key
  }
}
