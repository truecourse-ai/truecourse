import { describe, it, expect } from 'vitest';
import type { PublicRunRecord } from '../../packages/core/src/lib/sessions-store.js';
import { assertGuardGenerateResumeCommit, guardGenerateResume } from '../../packages/core/src/services/guard-generate/resume.js';

const keys = ['index', 'extract', 'interfaces', 'flows', 'match', 'author', 'validate'];
function run(statuses: string[], status = 'interrupted'): PublicRunRecord {
  return {
    runId: 'interrupted-run', command: 'guard-generate', status, gitRef: 'a'.repeat(40),
    startedAt: '2026-09-12T10:00:00Z', sessions: [],
    display: { blocks: [{ kind: 'checklist', items: keys.map((key, i) => ({ key, label: key, status: statuses[i] ?? 'pending' })) }] },
  } as PublicRunRecord;
}

describe('guard generation resume boundaries', () => {
  it('restores the completed stages when settling was interrupted, keeping workers resumable', () => {
    expect(guardGenerateResume(run(['done', 'done', 'done', 'done', 'done', 'active', 'active'])))
      .toEqual({ runId: 'interrupted-run', gitRef: 'a'.repeat(40), completedSteps: keys.slice(0, 5) });
  });

  it('does not mistake the area counter for a completed epic synthesis pass', () => {
    expect(guardGenerateResume(run(['done', 'done', 'done', 'done'])).completedSteps)
      .toEqual(keys.slice(0, 3));
  });

  it('does not skip extraction interrupted after its final pool tick but before fold', () => {
    expect(guardGenerateResume(run(['done', 'done'])).completedSteps).toEqual(['index']);
  });

  it('does not assume missing or malformed progress completed anything', () => {
    const record = run([]);
    record.display = { blocks: [{ kind: 'checklist', items: [{ key: 'extract', status: 'done' }, null] }] };
    expect(guardGenerateResume(record).completedSteps).toEqual([]);
  });

  it.each(['running', 'completed'])('rejects a %s run', status => {
    expect(() => guardGenerateResume(run([], status))).toThrow('Only interrupted or failed');
  });

  it('rejects another command', () => {
    expect(() => guardGenerateResume({ ...run([]), command: 'spec-scan' })).toThrow('Only interrupted or failed');
  });

  it('allows retrying an interruption before checkout established a commit', () => {
    const resume = guardGenerateResume({ ...run([]), gitRef: 'unknown' });
    expect(() => assertGuardGenerateResumeCommit(resume, 'b'.repeat(40))).not.toThrow();
    expect(() => assertGuardGenerateResumeCommit({ ...resume, completedSteps: ['index'] }, 'b'.repeat(40)))
      .toThrow('commit has changed');
  });
});
