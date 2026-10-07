import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  composeClaimCoverage,
  readGuardEvidenceAt,
} from '../../packages/core/src/commands/guard-read';
import { claimContentHash } from '../../packages/shared/src/guard/claims';
import type { GuardGenerateReport } from '../../packages/shared/src/index';
import { installWorkTreeGuardStore, resetGuardStore } from '../helpers/work-tree-guard-store';

const repos: string[] = [];
beforeEach(() => {
  installWorkTreeGuardStore();
});
afterEach(() => {
  resetGuardStore();
  while (repos.length) fs.rmSync(repos.pop()!, { recursive: true, force: true });
});
function repo(): string {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-read-'));
  repos.push(r);
  return r;
}

const DOC = 'docs/cli.md';

function report(over: Partial<GuardGenerateReport>): GuardGenerateReport {
  return {
    generatedAt: '2026-07-08T00:00:00.000Z',
    status: 'ok',
    sectionsTotal: 1,
    sectionsChanged: 1,
    skippedUnchanged: 0,
    noChanges: false,
    written: [],
    coverageGaps: [],
    birthFindings: [],
    errors: [],
    extractionFailures: [],
    orphaned: [],
    ...over,
  };
}

describe('composeClaimCoverage — dismissed status', () => {
  it('paints a dismissed claim as "dismissed" with the note, and totals it under Not testable', () => {
    const body = { doc: DOC, anchor: 'version', title: 'the --version flag prints the semver', claim: 'the --version flag prints the semver.' };
    const view = composeClaimCoverage({
      manifest: null,
      latest: null,
      result: report({}),
      claims: {
        version: 1,
        generatedAt: '2026-07-08T00:00:00.000Z',
        claims: [{ id: 'claim::version', ...body, contentHash: claimContentHash(body) }],
        untestable: [],
      },
      decisions: {
        version: 1,
        dismissedClaims: [{ claimId: 'claim::version', dismissedAt: '2026-07-08T00:00:00.000Z', note: 'not a product promise' }],
        dismissedFlows: [],
      },
    });
    expect(view.claims[0]).toMatchObject({ status: 'dismissed', dismissed: true, reason: 'not a product promise' });
    expect(view.totals.dismissed).toBe(1);
    expect(view.totals.byStatus['not-testable']).toBe(1);
  });
});

describe('readGuardEvidenceAt — birth-finding evidence by path', () => {
  const RUN = '2026-07-08T00-00-00Z_abc12345';
  const SCN = 'version.1';
  const evDir = `.truecourse/guard/evidence/${RUN}/${SCN}`;

  function seedEvidence(r: string): void {
    const dir = path.join(r, evDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'transcript.txt'), 'the full transcript\n');
    fs.writeFileSync(path.join(dir, 'stdout.txt'), 'stdout body\n');
  }

  it('reads a birth-evidence transcript addressed by its evidence dir', async () => {
    const r = repo();
    seedEvidence(r);
    expect(await readGuardEvidenceAt(r, evDir)).toBe('the full transcript\n');
    expect(await readGuardEvidenceAt(r, evDir, 'stdout.txt')).toBe('stdout body\n');
  });

  it('returns null for a missing file, an unsafe filename, or a traversal outside guard/evidence', async () => {
    const r = repo();
    seedEvidence(r);
    expect(await readGuardEvidenceAt(r, evDir, 'nope.txt')).toBeNull();
    expect(await readGuardEvidenceAt(r, evDir, '../../secret')).toBeNull();
    // A path that escapes the evidence root is refused even when the file exists.
    fs.writeFileSync(path.join(r, '.truecourse', 'guard', 'LATEST.json'), '{}');
    expect(await readGuardEvidenceAt(r, '.truecourse/guard', 'LATEST.json')).toBeNull();
    expect(await readGuardEvidenceAt(r, '.truecourse/guard/evidence/../../..', 'package.json')).toBeNull();
  });
});
