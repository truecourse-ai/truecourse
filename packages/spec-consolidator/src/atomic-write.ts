/**
 * Atomic file writes (write-to-tmp + rename) — the store convention for every
 * file the consolidator persists: a reader must never observe a half-written
 * file, even when a scan rewrites it mid-run.
 *
 * Hand-rolled rather than imported from `@truecourse/core` so the consolidator
 * stays free of a dependency on it.
 */

import fs from 'node:fs';
import path from 'node:path';

export function atomicWriteFile(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, contents);
  fs.renameSync(tmp, file);
}

export function atomicWriteJson(file: string, value: unknown): void {
  atomicWriteFile(file, JSON.stringify(value, null, 2) + '\n');
}
