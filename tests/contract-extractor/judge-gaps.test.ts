/**
 * The gap auto-close judge: drops justified gaps (over-enumeration / covered
 * elsewhere), keeps genuine misses annotated with a reason, and is best-effort
 * (a judge failure keeps every gap rather than dropping a real one).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import { judgeGaps, type GapJudgeRunner } from '../../packages/contract-extractor/src/judge-gaps.js';
import type { AreaGenInput, CoverageGap } from '../../packages/contract-extractor/src/index.js';

let scope: string;
beforeEach(() => {
  resetKvCacheStore();
  scope = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-judge-gaps-'));
});
afterEach(() => fs.rmSync(scope, { recursive: true, force: true }));

const area: AreaGenInput = {
  areaId: 'core/customers-entity',
  product: 'core',
  concern: 'customers-entity',
  docs: [{ ref: 'docs/orders.md', content: '# Orders\nForbidden: POST /orders/:id/replace.' }],
};

const gaps: CoverageGap[] = [
  { areaId: 'core/customers-entity', kind: 'FieldExposure', identity: 'order.server-assigned-fields' },
  { areaId: 'core/customers-entity', kind: 'ForbiddenArtifact', identity: 'replace-order-endpoint' },
];

describe('judgeGaps', () => {
  it('drops justified gaps and keeps genuine misses with a reason', async () => {
    const runner: GapJudgeRunner = async () => ({
      verdicts: {
        'FieldExposure:order.server-assigned-fields': {
          justified: true,
          reason: 'already written as order-response-fields',
          coveredBy: { kind: 'FieldExposure', identity: 'order-response-fields' },
        },
        'ForbiddenArtifact:replace-order-endpoint': {
          justified: false,
          reason: 'docs forbid it but no contract was written',
        },
      },
    });
    const kept = await judgeGaps(scope, area, gaps, [], { runner });
    expect(kept).toHaveLength(1);
    expect(kept[0].identity).toBe('replace-order-endpoint');
    expect(kept[0].justified).toBe(false);
    expect(kept[0].reason).toContain('forbid');
  });

  it('keeps ALL gaps when the judge throws (best-effort — never drop a real gap)', async () => {
    const runner: GapJudgeRunner = async () => {
      throw new Error('boom');
    };
    const kept = await judgeGaps(scope, area, gaps, [], { runner });
    expect(kept).toHaveLength(2);
  });

  it('is a no-op when there are no gaps or it is disabled', async () => {
    const runner: GapJudgeRunner = async () => ({ verdicts: {} });
    expect(await judgeGaps(scope, area, [], [], { runner })).toEqual([]);
    expect(await judgeGaps(scope, area, gaps, [], { runner, enabled: false })).toEqual(gaps);
  });
});
