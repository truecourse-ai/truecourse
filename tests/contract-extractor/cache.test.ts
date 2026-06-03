import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  cachePaths,
  ensureCacheDirs,
  gcOrphanedSlices,
  readManifest,
  readSliceEntry,
  writeManifest,
  writeSliceEntry,
} from '../../packages/contract-extractor/src/cache.js';
import type { Manifest, SpecSlice } from '../../packages/contract-extractor/src/types.js';

describe('slice cache', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-cache-'));
  });
  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const sampleSlice: SpecSlice = {
    id: 'sliceid-1',
    specPath: 'SPEC.md',
    headingPath: ['Auth'],
    lineRange: [10, 20],
    text: 'Bearer token required.',
    headingLevel: 2,
  };

  it('round-trips a slice cache entry', async () => {
    ensureCacheDirs(tmpRoot);
    await writeSliceEntry(tmpRoot, sampleSlice, { fragments: [] });
    const back = await readSliceEntry(tmpRoot, sampleSlice.id);
    expect(back).not.toBeNull();
    expect(back!.id).toBe(sampleSlice.id);
    expect(back!.headingPath).toEqual(['Auth']);
    expect(back!.result.fragments).toEqual([]);
  });

  it('returns null for a missing slice id', async () => {
    expect(await readSliceEntry(tmpRoot, 'nope')).toBeNull();
  });

  it('round-trips the manifest', () => {
    const manifest: Manifest = {
      version: 1,
      specs: {
        'SPEC.md': {
          fileHash: 'abc',
          slices: [{ headingPath: ['Auth'], sliceId: 'sliceid-1' }],
        },
      },
    };
    writeManifest(tmpRoot, manifest);
    const back = readManifest(tmpRoot);
    expect(back).toEqual(manifest);
  });

  it('garbage-collects slice entries no longer referenced by the manifest', async () => {
    ensureCacheDirs(tmpRoot);
    await writeSliceEntry(tmpRoot, sampleSlice, { fragments: [] });
    await writeSliceEntry(
      tmpRoot,
      { ...sampleSlice, id: 'orphan' },
      { fragments: [] },
    );
    const manifest: Manifest = {
      version: 1,
      specs: {
        'SPEC.md': {
          fileHash: 'abc',
          slices: [{ headingPath: ['Auth'], sliceId: sampleSlice.id }],
        },
      },
    };
    const removed = gcOrphanedSlices(tmpRoot, manifest);
    expect(removed).toBe(1);
    expect(await readSliceEntry(tmpRoot, 'orphan')).toBeNull();
    expect(await readSliceEntry(tmpRoot, sampleSlice.id)).not.toBeNull();
  });

  it('points at the expected on-disk locations', () => {
    const paths = cachePaths(tmpRoot);
    expect(paths.cacheDir).toBe(path.join(tmpRoot, '.truecourse', '.cache', 'extractor'));
    expect(paths.slicesDir).toBe(path.join(tmpRoot, '.truecourse', '.cache', 'extractor', 'slices'));
    expect(paths.manifestPath).toBe(path.join(tmpRoot, '.truecourse', '.cache', 'extractor', 'manifest.json'));
  });
});
