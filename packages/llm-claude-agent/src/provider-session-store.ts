/**
 * File-backed implementation of the SDK's `sessionStore` mirror adapter
 * (§3.3: provider session state lives in OUR store). Pointed at a directory
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
      fs.appendFileSync(fileFor(key), entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
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
          if (i === lines.length - 1) break; // crash-truncated final line
          throw new Error(`corrupt provider session line ${i} in ${fileFor(key)}`);
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
