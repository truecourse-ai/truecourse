import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  readGuardDecisions,
  writeGuardDecisions,
  dismissGuardClaim,
  undismissGuardClaim,
  dismissGuardFinding,
  undismissGuardFinding,
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
    expect(readGuardDecisions(repo())).toEqual({ version: 1, dismissedClaims: [], dismissedFindings: [] });
  });

  it('writes to .truecourse/scenarios/decisions.json (next to recipe/manifest)', () => {
    const r = repo();
    writeGuardDecisions(r, { version: 1, dismissedClaims: [], dismissedFindings: [] });
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
    expect(readGuardDecisions(r)).toEqual({ version: 1, dismissedClaims: [], dismissedFindings: [] });
  });

  it('re-dismissing the same identity refreshes in place (no duplicate)', () => {
    const r = repo();
    const id = { doc: 'docs/cli.md', anchor: 'version', title: 'the --version claim' };
    dismissGuardClaim(r, { ...id, dismissedAt: 't1' });
    const after = dismissGuardClaim(r, { ...id, dismissedAt: 't2', note: 'flaky' });
    expect(after.dismissedClaims).toHaveLength(1);
    expect(after.dismissedClaims[0]).toMatchObject({ ...id, dismissedAt: 't2', note: 'flaky' });
  });

  it('a read-modify-write preserves unknown top-level keys (a future array survives an old mutator)', () => {
    const r = repo();
    writeGuardDecisions(r, { version: 1, dismissedClaims: [], dismissedFindings: [] });
    const withUnknown = {
      version: 1,
      dismissedClaims: [],
      futureDecisions: [{ doc: 'docs/cli.md', anchor: 'version', someKey: 'x' }],
    };
    fs.writeFileSync(guardDecisionsPath(r), JSON.stringify(withUnknown));

    dismissGuardClaim(r, { doc: 'docs/cli.md', anchor: 'help', title: 'help lists commands', dismissedAt: 't1' });

    const onDisk = JSON.parse(fs.readFileSync(guardDecisionsPath(r), 'utf-8')) as Record<string, unknown>;
    expect(onDisk.futureDecisions).toEqual(withUnknown.futureDecisions);
    expect((onDisk.dismissedClaims as unknown[])).toHaveLength(1);

    undismissGuardClaim(r, { doc: 'docs/cli.md', anchor: 'help', title: 'help lists commands' });
    const after = JSON.parse(fs.readFileSync(guardDecisionsPath(r), 'utf-8')) as Record<string, unknown>;
    expect(after.futureDecisions).toEqual(withUnknown.futureDecisions);
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

describe('guard finding-dismissal store (per-finding identity)', () => {
  const entry = (over: Record<string, unknown> = {}) => ({
    doc: 'docs/cli.md',
    anchor: 'version',
    scenarioHash: 'deadbeefdeadbeef',
    yaml: 'guard: 1\n',
    title: 'the scenario title',
    claim: 'the claim text',
    dismissedAt: '2026-07-16T00:00:00.000Z',
    ...over,
  });

  it('dismiss adds an entry; re-dismissing the same identity refreshes in place', () => {
    const r = repo();
    dismissGuardFinding(r, entry());
    const after = dismissGuardFinding(r, entry({ note: 'noise', dismissedAt: 't2' }));
    expect(after.dismissedFindings).toHaveLength(1);
    expect(after.dismissedFindings[0]).toMatchObject({ note: 'noise', dismissedAt: 't2' });
    // The legacy array is untouched.
    expect(after.dismissedClaims).toEqual([]);
  });

  it('undismiss removes by identity (no-op when absent) and leaves legacy entries alone', () => {
    const r = repo();
    dismissGuardClaim(r, { doc: 'docs/cli.md', anchor: 'version', title: 'legacy claim', dismissedAt: 't0' });
    dismissGuardFinding(r, entry());
    const after = undismissGuardFinding(r, { doc: 'docs/cli.md', anchor: 'version', scenarioHash: 'deadbeefdeadbeef' });
    expect(after.dismissedFindings).toEqual([]);
    expect(after.dismissedClaims).toHaveLength(1);
    expect(undismissGuardFinding(r, { doc: 'docs/cli.md', anchor: 'version', scenarioHash: 'deadbeefdeadbeef' }).dismissedFindings).toEqual([]);
  });
});
