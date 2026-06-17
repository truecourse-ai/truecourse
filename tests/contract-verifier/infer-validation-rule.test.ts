/**
 * Inference for the conditional field-requiredness (validation-rule) kind.
 *
 * The IL fixtures plant exactly one required-when guard (a gold customer
 * downgrading their own tier must supply a reason) and authoring documents it,
 * so against the full corpus the inferer is correctly SILENT. Against an empty
 * corpus the guard surfaces as an inferred validation-rule whose `.tc`
 * round-trips through the strict ohm grammar and resolves back to the same
 * typed contract. This file exercises both directions plus the structural
 * (name-independent) coverage subtraction.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { infer, renderDecision } from '../../packages/contract-verifier/src/infer/index.js';
import { parseTcFile } from '../../packages/contract-verifier/src/parser-ohm/index.js';
import { resolve } from '../../packages/contract-verifier/src/resolver/index.js';
import type { ValidationRuleContract } from '../../packages/contract-verifier/src/types/index.js';

const FIXTURES = {
  js: path.resolve(__dirname, '../fixtures/sample-js-project-il'),
  py: path.resolve(__dirname, '../fixtures/sample-python-project-il'),
} as const;

for (const [lang, root] of Object.entries(FIXTURES)) {
  describe(`infer validation-rule — ${lang}`, () => {
    const codeDir = path.join(root, 'code');

    it('surfaces the planted required-when guard against an empty corpus', async () => {
      const res = await infer({ contractsDir: path.join(root, '__none__'), codeDir });
      const vr = res.decisions.filter((d) => d.kind === 'ValidationRule');
      expect(vr).toHaveLength(1);
      const d = vr[0];
      expect(d.kind).toBe('ValidationRule');
      if (d.kind !== 'ValidationRule') return;
      expect(d.effect).toBe('required');
      expect(d.when.kind).toBe('eq');
      expect(d.confidence).toBe('high');
      expect(d.codeLoc.path.length).toBeGreaterThan(0);
    });

    it('the inferred .tc round-trips through the ohm grammar as a ValidationRule', async () => {
      const res = await infer({ contractsDir: path.join(root, '__none__'), codeDir });
      const d = res.decisions.find((x) => x.kind === 'ValidationRule')!;
      const { tcSource, relPath } = renderDecision(d);
      const resolved = resolve([parseTcFile(relPath, tcSource)]);
      const hard = resolved.errors.filter((e) => (e.severity ?? 'hard') === 'hard');
      expect(hard, hard.map((e) => e.message).join('; ')).toEqual([]);
      const artifact = [...resolved.index.values()][0];
      expect(artifact?.ref.type).toBe('ValidationRule');
      expect(artifact?.provenance).toBe('inferred');
      const c = artifact?.contract as ValidationRuleContract;
      expect(c.effect).toBe('required');
      expect(c.when.kind).toBe('eq');
      expect(c.actor).toBe('customer');
      expect(c.onViolation).toEqual({ status: 400, errorCode: 'downgrade_reason_required' });
    });

    it('is SILENT against the full authored corpus (coverage subtraction)', async () => {
      const res = await infer({ contractsDir: path.join(root, 'reference/contracts'), codeDir });
      expect(res.decisions.some((d) => d.kind === 'ValidationRule')).toBe(false);
    });
  });
}

describe('infer validation-rule — structural coverage subtraction is name-independent', () => {
  it('an authored rule with a different artifact name still covers the code guard', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-vr-'));
    try {
      fs.mkdirSync(path.join(dir, 'code'));
      fs.mkdirSync(path.join(dir, 'contracts'));
      // A guard: a reason is required when the plan tier is `pro`.
      fs.writeFileSync(
        path.join(dir, 'code', 'guard.ts'),
        [
          'export function check(plan: { tier: string }, reason?: string): void {',
          "  if (plan.tier === 'pro' && !reason) {",
          "    throw new Error('reason_required');",
          '  }',
          '}',
          '',
        ].join('\n'),
      );
      // Empty corpus → the guard surfaces.
      const uncovered = await infer({ contractsDir: path.join(dir, '__none__'), codeDir: path.join(dir, 'code') });
      expect(uncovered.decisions.filter((d) => d.kind === 'ValidationRule')).toHaveLength(1);

      // Author a rule with a totally different name but the SAME target+condition.
      fs.writeFileSync(
        path.join(dir, 'contracts', 'pro-reason.tc'),
        [
          'validation-rule billing.pro-needs-a-reason {',
          '  origin "SPEC.md" "Billing" 1..3',
          '  target reason',
          '  when eq plan.tier "pro"',
          '  effect required',
          '}',
          '',
        ].join('\n'),
      );
      const covered = await infer({ contractsDir: path.join(dir, 'contracts'), codeDir: path.join(dir, 'code') });
      expect(covered.decisions.some((d) => d.kind === 'ValidationRule')).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
