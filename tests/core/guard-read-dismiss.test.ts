import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  composeDocCoverage,
  readGuardEvidenceAt,
} from '../../packages/core/src/commands/guard-read';
import type { GuardGenerateReport } from '../../packages/shared/src/index';

const repos: string[] = [];
afterEach(() => {
  while (repos.length) fs.rmSync(repos.pop()!, { recursive: true, force: true });
});
function repo(): string {
  const r = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-read-'));
  repos.push(r);
  return r;
}

const DOC = 'docs/cli.md';
const CONTENT = ['# Version', 'the --version flag prints the semver'].join('\n');

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

describe('composeDocCoverage — dismissed status', () => {
  it('paints a section with a dismissed gap as status "dismissed" and totals it', () => {
    const cov = composeDocCoverage(DOC, CONTENT, {
      manifest: null,
      latest: null,
      result: report({
        coverageGaps: [{ doc: DOC, anchor: 'version', kind: 'dismissed', reason: 'dismissed: the --version claim' }],
      }),
    });
    const section = cov.sections.find((s) => s.anchor === 'version')!;
    expect(section.status).toBe('dismissed');
    expect(section.reason).toContain('dismissed');
    expect(cov.totals.dismissed).toBe(1);
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
