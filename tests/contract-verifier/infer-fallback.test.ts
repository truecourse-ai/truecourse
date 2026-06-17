/**
 * Inference for the null/absent → default RUNTIME coalescing (fallback) kind.
 *
 * The IL fixtures plant exactly one policy-grade fallback (a customer with no
 * recorded loyalty tier coalesces to the named constant `DEFAULT_LOYALTY_TIER`)
 * and authoring documents it, so against the full corpus the inferer is
 * correctly SILENT. Against an empty corpus the coalescing surfaces as an
 * inferred fallback whose `.tc` round-trips through the strict ohm grammar and
 * resolves back to the same typed contract. This file exercises both directions
 * plus the structural (name-independent, cross-convention) coverage subtraction
 * and the named-constant-only fidelity bar.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { infer, renderDecision } from '../../packages/contract-verifier/src/infer/index.js';
import { parseTcFile } from '../../packages/contract-verifier/src/parser-ohm/index.js';
import { resolve } from '../../packages/contract-verifier/src/resolver/index.js';
import type { FallbackContract } from '../../packages/contract-verifier/src/types/index.js';

const FIXTURES = {
  js: path.resolve(__dirname, '../fixtures/sample-js-project-il'),
  py: path.resolve(__dirname, '../fixtures/sample-python-project-il'),
} as const;

for (const [lang, root] of Object.entries(FIXTURES)) {
  describe(`infer fallback — ${lang}`, () => {
    const codeDir = path.join(root, 'code');

    it('surfaces the planted named-constant coalescing against an empty corpus', async () => {
      const res = await infer({ contractsDir: path.join(root, '__none__'), codeDir });
      const fb = res.decisions.filter((d) => d.kind === 'Fallback');
      expect(fb).toHaveLength(1);
      const d = fb[0];
      expect(d.kind).toBe('Fallback');
      if (d.kind !== 'Fallback') return;
      // The fixture coalesces the loyalty tier (loyaltyTier / loyalty_tier).
      expect(d.field.toLowerCase().replace(/[^a-z0-9]/g, '')).toBe('loyaltytier');
      expect(d.defaultValue).toEqual({ kind: 'identifier', ref: 'DEFAULT_LOYALTY_TIER' });
      expect(d.trigger).toBe('null-or-absent');
      expect(d.confidence).toBe('high');
      expect(d.codeLoc.path.length).toBeGreaterThan(0);
    });

    it('the inferred .tc round-trips through the ohm grammar as a Fallback', async () => {
      const res = await infer({ contractsDir: path.join(root, '__none__'), codeDir });
      const d = res.decisions.find((x) => x.kind === 'Fallback')!;
      const { tcSource, relPath } = renderDecision(d);
      const resolved = resolve([parseTcFile(relPath, tcSource)]);
      const hard = resolved.errors.filter((e) => (e.severity ?? 'hard') === 'hard');
      expect(hard, hard.map((e) => e.message).join('; ')).toEqual([]);
      const artifact = [...resolved.index.values()][0];
      expect(artifact?.ref.type).toBe('Fallback');
      expect(artifact?.provenance).toBe('inferred');
      const c = artifact?.contract as FallbackContract;
      expect(c.trigger).toBe('null-or-absent');
      expect(c.defaultValue).toEqual({ kind: 'identifier', ref: 'DEFAULT_LOYALTY_TIER' });
    });

    it('is SILENT against the full authored corpus (coverage subtraction)', async () => {
      const res = await infer({ contractsDir: path.join(root, 'reference/contracts'), codeDir });
      expect(res.decisions.some((d) => d.kind === 'Fallback')).toBe(false);
    });
  });
}

describe('infer fallback — only named-constant defaults clear the fidelity bar', () => {
  it('skips an inline-literal coalescing (incidental default), surfaces a named-constant one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-fb-'));
    try {
      fs.mkdirSync(path.join(dir, 'code'));
      fs.writeFileSync(
        path.join(dir, 'code', 'config.ts'),
        [
          'export const DEFAULT_REGION = "us-east-1";',
          '',
          'export function resolve(opts: { region?: string; limit?: number }) {',
          // named-constant default → policy-grade, inferred
          '  const region = opts.region ?? DEFAULT_REGION;',
          // inline-literal default → incidental, skipped
          '  const limit = opts.limit ?? 20;',
          '  return { region, limit };',
          '}',
          '',
        ].join('\n'),
      );
      const res = await infer({ contractsDir: path.join(dir, '__none__'), codeDir: path.join(dir, 'code') });
      const fb = res.decisions.filter((d) => d.kind === 'Fallback');
      expect(fb).toHaveLength(1);
      const d = fb[0];
      if (d.kind !== 'Fallback') throw new Error('expected Fallback');
      expect(d.field).toBe('region');
      expect(d.defaultValue).toEqual({ kind: 'identifier', ref: 'DEFAULT_REGION' });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('infer fallback — structural coverage subtraction is name-independent', () => {
  it('an authored fallback with a different artifact name still covers the code coalescing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-fb-cov-'));
    try {
      fs.mkdirSync(path.join(dir, 'code'));
      fs.mkdirSync(path.join(dir, 'contracts'));
      // A coalescing: a missing currency falls back to the named default.
      fs.writeFileSync(
        path.join(dir, 'code', 'booking.ts'),
        [
          'export const DEFAULT_CURRENCY = "USD";',
          '',
          'export function price(booking: { currency?: string }) {',
          '  const currency = booking.currency ?? DEFAULT_CURRENCY;',
          '  return currency;',
          '}',
          '',
        ].join('\n'),
      );
      // Empty corpus → the coalescing surfaces.
      const uncovered = await infer({ contractsDir: path.join(dir, '__none__'), codeDir: path.join(dir, 'code') });
      expect(uncovered.decisions.filter((d) => d.kind === 'Fallback')).toHaveLength(1);

      // Author a fallback with a totally different name but the SAME target.
      fs.writeFileSync(
        path.join(dir, 'contracts', 'currency-default.tc'),
        [
          'fallback booking.some-other-name {',
          '  origin "SPEC.md" "Booking" 1..3',
          '  target currency',
          '  when null-or-absent',
          '  default DEFAULT_CURRENCY',
          '}',
          '',
        ].join('\n'),
      );
      const covered = await infer({ contractsDir: path.join(dir, 'contracts'), codeDir: path.join(dir, 'code') });
      expect(covered.decisions.some((d) => d.kind === 'Fallback')).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
