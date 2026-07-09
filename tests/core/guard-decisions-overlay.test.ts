/**
 * The guard decisions PR-overlay API — the guard analogue of the spec
 * `mergeDecisions` / `getDecisions` / `promote|discardDecisionsOverlay` seam.
 * `mergeGuardDecisions` unions `dismissedClaims` by identity (overlay wins); the
 * PR-scoped ops are enterprise-only, so on the OSS file store a `pr` opt fails loud.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  mergeGuardDecisions,
  getGuardDecisions,
  promoteGuardDecisionsOverlay,
  discardGuardDecisionsOverlay,
  writeGuardDecisions,
} from '../../packages/core/src/commands/guard-read';
import { resetGuardStore } from '../../packages/core/src/lib/guard-store';
import type { GuardDecisions, GuardDismissedClaim } from '../../packages/shared/src/index';

function claim(over: Partial<GuardDismissedClaim> = {}): GuardDismissedClaim {
  return {
    doc: 'docs/cli.md',
    anchor: 'version',
    title: 'the --version flag prints the semver',
    dismissedAt: '2026-07-08T00:00:00.000Z',
    ...over,
  };
}
const decisions = (claims: GuardDismissedClaim[]): GuardDecisions => ({
  version: 1,
  dismissedClaims: claims,
});

describe('mergeGuardDecisions — union dismissedClaims by identity', () => {
  it('unions distinct dismissals from base and overlay', () => {
    const base = decisions([claim({ anchor: 'a' })]);
    const overlay = decisions([claim({ anchor: 'b' })]);
    const merged = mergeGuardDecisions(base, overlay);
    expect(merged.dismissedClaims.map((c) => c.anchor).sort()).toEqual(['a', 'b']);
  });

  it('the overlay wins for a colliding identity (doc+anchor+title)', () => {
    const base = decisions([claim({ note: 'base note' })]);
    const overlay = decisions([claim({ note: 'overlay note' })]);
    const merged = mergeGuardDecisions(base, overlay);
    expect(merged.dismissedClaims).toHaveLength(1);
    expect(merged.dismissedClaims[0].note).toBe('overlay note');
  });

  it('an empty overlay returns the base dismissals', () => {
    const base = decisions([claim({ anchor: 'a' }), claim({ anchor: 'b' })]);
    const merged = mergeGuardDecisions(base, decisions([]));
    expect(merged.dismissedClaims.map((c) => c.anchor).sort()).toEqual(['a', 'b']);
  });
});

describe('PR-scoped guard decisions are enterprise-only on the file store', () => {
  let repo: string;
  beforeEach(() => {
    resetGuardStore(); // file-backed default (OSS)
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-overlay-'));
  });
  afterEach(() => {
    resetGuardStore();
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it('getGuardDecisions without a PR opt is the repo file (unchanged OSS behavior)', async () => {
    await writeGuardDecisions(repo, decisions([claim()]));
    const d = await getGuardDecisions(repo);
    expect(d.dismissedClaims).toHaveLength(1);
  });

  it('getGuardDecisions with a PR opt rejects on the file store', async () => {
    await expect(getGuardDecisions(repo, { pr: 7 })).rejects.toThrow(/enterprise store/);
  });

  it('promote / discard overlay reject on the file store', async () => {
    await expect(promoteGuardDecisionsOverlay(repo, 7)).rejects.toThrow(/enterprise store/);
    await expect(discardGuardDecisionsOverlay(repo, 7)).rejects.toThrow(/enterprise store/);
  });
});
