import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  writeVerifyLatest,
  clearVerifyLatestCache,
} from '../../packages/core/src/lib/verify-store';
import type { ContractDrift, Severity } from '@truecourse/contract-verifier';
import { runDriftsList } from '../../tools/cli/src/commands/drifts';

function drift(obligationKey: string, severity: Severity = 'high'): ContractDrift {
  return {
    id: Math.random().toString(36).slice(2),
    type: 'contract-drift',
    artifactRef: { type: 'Operation', identity: obligationKey, quoted: false },
    obligationKey,
    severity,
    filePath: '/code/x.ts',
    lineStart: 1,
    lineEnd: 1,
    message: `message for ${obligationKey}`,
  };
}

async function seedLatest(repo: string, drifts: ContractDrift[]): Promise<void> {
  const bySeverity: Record<Severity, number> = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
  for (const d of drifts) bySeverity[d.severity]++;
  await writeVerifyLatest(repo, {
    head: 'run.json',
    run: {
      id: 'run',
      verifiedAt: '2026-01-01T00:00:00.000Z',
      branch: 'main',
      commitHash: null,
      contractsDir: '.truecourse/contracts',
      codeDir: '.',
    },
    artifactCount: drifts.length,
    extractedOperationCount: 0,
    drifts,
    resolverErrors: [],
    unresolvedRefs: [],
    summary: { total: drifts.length, bySeverity },
  });
}

let repo: string;
let out: string;
let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-drifts-'));
  clearVerifyLatestCache();
  out = '';
  spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    out += String(chunk);
    return true;
  });
});
afterEach(() => {
  spy.mockRestore();
  fs.rmSync(repo, { recursive: true, force: true });
  clearVerifyLatestCache();
});

describe('runDriftsList', () => {
  it('points to `truecourse verify` when there is no baseline', async () => {
    await runDriftsList({ cwd: repo });
    expect(out).toContain('Run `truecourse verify`');
  });

  it('reports "no drift detected" on an empty baseline', async () => {
    await seedLatest(repo, []);
    await runDriftsList({ cwd: repo });
    expect(out).toContain('No drift detected');
  });

  it('caps at the default limit (20) and prints a "more" hint with the next offset', async () => {
    await seedLatest(repo, Array.from({ length: 25 }, (_, i) => drift(`key${i}`)));
    await runDriftsList({ cwd: repo, limit: 20, offset: 0 });
    expect(out).toContain('key0');
    expect(out).toContain('key19');
    expect(out).not.toContain('key20');
    expect(out).toContain('5 more');
    expect(out).toContain('drifts list --offset 20');
    expect(out).toContain('Showing 1–20 of 25');
  });

  it('--all shows every drift and no "more" hint', async () => {
    await seedLatest(repo, Array.from({ length: 25 }, (_, i) => drift(`key${i}`)));
    await runDriftsList({ cwd: repo, limit: Infinity, offset: 0 });
    expect(out).toContain('key24');
    expect(out).not.toContain('drifts list --offset');
    expect(out).toContain('Showing 1–25 of 25');
  });

  it('--offset pages into the tail', async () => {
    await seedLatest(repo, Array.from({ length: 25 }, (_, i) => drift(`key${i}`)));
    await runDriftsList({ cwd: repo, limit: 20, offset: 20 });
    expect(out).toContain('key20');
    expect(out).toContain('key24');
    expect(out).not.toContain('key19');
    expect(out).toContain('Showing 21–25 of 25');
  });

  it('--severity filters to the requested tiers', async () => {
    await seedLatest(repo, [
      drift('crit-one', 'critical'),
      drift('high-one', 'high'),
      drift('crit-two', 'critical'),
    ]);
    await runDriftsList({ cwd: repo, severity: ['critical'] });
    expect(out).toContain('crit-one');
    expect(out).toContain('crit-two');
    expect(out).not.toContain('high-one');
    expect(out).toContain('Showing 1–2 of 2');
  });

  it('reports the severity filter when nothing matches', async () => {
    await seedLatest(repo, [drift('high-one', 'high')]);
    await runDriftsList({ cwd: repo, severity: ['critical'] });
    expect(out).toContain('No drifts match severity filter: critical');
  });
});
