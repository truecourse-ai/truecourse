/**
 * Which date orders a synced doc against the rest of the corpus.
 *
 * Both materialization paths ask this — the workspace scan writing a scratch
 * tree, and the repo inheritance hook writing a checkout — and they had answered
 * differently. The scan fell back to the sync instant; inheritance fell back to
 * nothing, so a row predating the source-date columns was stamped with the write
 * instant instead and read as newer than every doc it should have lost to. That
 * inversion is what this work set out to remove, so the rule lives in one place
 * and these pin it there.
 */

import { describe, it, expect } from 'vitest';
import { lastTouchedOf } from '../../ee/packages/server/src/knowledge/sync';

const SYNCED = '2026-08-20T00:00:00.000Z';
const SOURCE = '2026-01-05T00:00:00.000Z';

describe('lastTouchedOf', () => {
  it("prefers what the source said over when we happened to sync it", () => {
    // The sync instant is the same for every doc in a run, so it can order nothing.
    expect(lastTouchedOf({ externalUpdatedAt: SOURCE, lastSyncedAt: SYNCED })).toBe(SOURCE);
  });

  it('falls back to the sync instant for a row written before the column existed', () => {
    expect(lastTouchedOf({ externalUpdatedAt: null, lastSyncedAt: SYNCED })).toBe(SYNCED);
  });

  it('never answers undefined — an undated doc would take the write instant instead', () => {
    // The inheritance path used to, and a file with no stamp keeps its mtime:
    // the moment it was written, which is newer than everything real.
    expect(lastTouchedOf({ externalUpdatedAt: null, lastSyncedAt: SYNCED })).toBeDefined();
  });
});
