import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readGuardDecisions,
  writeGuardDecisions,
  dismissGuardClaim,
  undismissGuardClaim,
  guardDecisionsPath,
} from '../../packages/guard-runner/src/index';

const repos: string[] = [];
afterEach(() => {
  while (repos.length) fs.rmSync(repos.pop()!, { recursive: true, force: true });
});
function repo(): string {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-dec-'));
  repos.push(r);
  return r;
}

describe('guard decisions store', () => {
  it('reads an empty decisions file when none exists', () => {
    expect(readGuardDecisions(repo())).toEqual({ version: 1, dismissedClaims: [] });
  });

  it('writes to .truecourse/scenarios/decisions.json (next to recipe/manifest)', () => {
    const r = repo();
    writeGuardDecisions(r, { version: 1, dismissedClaims: [] });
    expect(guardDecisionsPath(r)).toBe(path.join(r, '.truecourse', 'scenarios', 'decisions.json'));
    expect(fs.existsSync(guardDecisionsPath(r))).toBe(true);
  });

  it('dismiss adds a claim; a corrupt file reads as empty (never blocks a run)', () => {
    const r = repo();
    const claim = { doc: 'docs/cli.md', anchor: 'version', title: 'the --version claim', dismissedAt: '2026-07-08T00:00:00.000Z' };
    const after = dismissGuardClaim(r, claim);
    expect(after.dismissedClaims).toEqual([claim]);
    expect(readGuardDecisions(r).dismissedClaims).toEqual([claim]);

    fs.writeFileSync(guardDecisionsPath(r), '{ not json');
    expect(readGuardDecisions(r)).toEqual({ version: 1, dismissedClaims: [] });
  });

  it('re-dismissing the same identity refreshes in place (no duplicate)', () => {
    const r = repo();
    const id = { doc: 'docs/cli.md', anchor: 'version', title: 'the --version claim' };
    dismissGuardClaim(r, { ...id, dismissedAt: 't1' });
    const after = dismissGuardClaim(r, { ...id, dismissedAt: 't2', note: 'flaky' });
    expect(after.dismissedClaims).toHaveLength(1);
    expect(after.dismissedClaims[0]).toMatchObject({ ...id, dismissedAt: 't2', note: 'flaky' });
  });

  it('undismiss removes by identity (no-op when absent)', () => {
    const r = repo();
    const id = { doc: 'docs/cli.md', anchor: 'version', title: 'the --version claim' };
    dismissGuardClaim(r, { ...id, dismissedAt: 't1' });
    expect(undismissGuardClaim(r, id).dismissedClaims).toEqual([]);
    // A second undismiss (already gone) is a clean no-op.
    expect(undismissGuardClaim(r, id).dismissedClaims).toEqual([]);
  });
});
