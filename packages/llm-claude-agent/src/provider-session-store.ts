/**
 * File-backed implementation of the SDK's `sessionStore` mirror adapter
 * (provider session state lives in OUR store). Pointed at a directory
 * inside the run's sessions store (`<runDir>/provider/`), it keeps the
 * provider-native transcript a parked session resumes from — immune to the
 * harness's own `cleanupPeriodDays`, a machine move, or a wiped harness home.
 *
 * Entries carry a `uuid` idempotency key per the SessionStore contract; this
 * adapter appends plainly and dedupes on load, so replays never double.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SdkSessionKey, SdkSessionStore, SdkSessionStoreEntry } from './sdk-types.js';

export function providerSessionStore(dir: string): SdkSessionStore {
  const fileFor = (key: SdkSessionKey): string => {
    const suffix = key.subpath ? `.${sanitize(key.subpath)}` : '';
    return path.join(dir, `${sanitize(key.sessionId)}${suffix}.jsonl`);
  };
  return {
    async append(key, entries) {
      if (entries.length === 0) return;
      fs.mkdirSync(dir, { recursive: true });
      const file = fileFor(key);
      // A crash mid-append leaves the file without its trailing newline. The
      // next append must not glue its first entry onto that truncated line —
      // the merged line would never parse again, corrupting the store for
      // good. Open the newline instead, so the debris stays a line of its own
      // (load skips it) and every new entry stays whole.
      const payload = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
      fs.appendFileSync(file, endsWithNewline(file) ? payload : '\n' + payload);
    },
    async load(key) {
      let raw: string;
      try {
        raw = fs.readFileSync(fileFor(key), 'utf-8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw err;
      }
      const entries: SdkSessionStoreEntry[] = [];
      const seen = new Set<string>();
      const lines = raw.split('\n').filter((line) => line.trim() !== '');
      for (let i = 0; i < lines.length; i++) {
        let entry: SdkSessionStoreEntry;
        try {
          entry = JSON.parse(lines[i]) as SdkSessionStoreEntry;
        } catch {
          // Crash debris: a truncated append, at the tail or (healed by the
          // append above) mid-file. The entry was never fully persisted, so
          // skipping it is the honest recovery — the rest of the mirror stays
          // usable instead of failing every resume forever.
          continue;
        }
        if (typeof entry.uuid === 'string') {
          if (seen.has(entry.uuid)) continue;
          seen.add(entry.uuid);
        }
        entries.push(entry);
      }
      return entries;
    },
  };
}

function sanitize(id: string): string {
  return id.replace(/[^A-Za-z0-9._-]/g, '_');
}

/** Does the file end in `\n`? A missing file counts as yes (nothing to heal). */
function endsWithNewline(file: string): boolean {
  let fd: number;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return true;
  }
  try {
    const size = fs.fstatSync(fd).size;
    if (size === 0) return true;
    const buf = Buffer.alloc(1);
    fs.readSync(fd, buf, 0, 1, size - 1);
    return buf[0] === 0x0a;
  } finally {
    fs.closeSync(fd);
  }
}
