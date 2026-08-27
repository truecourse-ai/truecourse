/**
 * The file-backed provider session mirror. The
 * cases that matter are the crash ones: an append truncated mid-write must
 * neither poison later appends (a glued, never-parsable line) nor fail every
 * load forever — the store is what a parked session resumes from.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { providerSessionStore } from '../../packages/llm-claude-agent/src/index';

const key = { projectKey: 'proj', sessionId: 'sess-1' };

function makeStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-provider-store-'));
  return { dir, store: providerSessionStore(dir), file: path.join(dir, 'sess-1.jsonl') };
}

const entry = (uuid: string) => ({ uuid, type: 'message', body: uuid });

describe('providerSessionStore', () => {
  it('round-trips entries and dedupes on uuid', async () => {
    const { store } = makeStore();
    await store.append(key, [entry('a'), entry('b')]);
    await store.append(key, [entry('b'), entry('c')]);
    expect((await store.load(key))?.map((e) => e.uuid)).toEqual(['a', 'b', 'c']);
  });

  it('loads past a crash-truncated final line', async () => {
    const { store, file } = makeStore();
    await store.append(key, [entry('a')]);
    fs.appendFileSync(file, '{"uuid":"b","tru'); // crash mid-append
    expect((await store.load(key))?.map((e) => e.uuid)).toEqual(['a']);
  });

  it('an append after a truncated one heals the file instead of gluing lines', async () => {
    const { store, file } = makeStore();
    await store.append(key, [entry('a')]);
    fs.appendFileSync(file, '{"uuid":"b","tru'); // crash mid-append
    await store.append(key, [entry('c')]);
    // The debris stays its own (skipped) line; `c` parses and the store keeps
    // working — before the heal, `{"uuid":"b","tru{"uuid":"c",…}` was one
    // permanently unparsable line.
    expect((await store.load(key))?.map((e) => e.uuid)).toEqual(['a', 'c']);
  });
});
