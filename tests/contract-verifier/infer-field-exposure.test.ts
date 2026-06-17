/**
 * Inference for the read-path field-exposure kind.
 *
 * The IL fixtures expose the customer loyalty tier on BOTH channels (an ORM
 * read projection AND the API response) on the public-profile read path, and
 * authoring documents it — so against the full corpus the inferer does NOT
 * re-surface `loyaltyTier`. It DOES surface the other both-channel fields the
 * same read path exposes that no spec records (`id`, `email`). Against an empty
 * corpus every both-channel exposure (including the tier) surfaces, and each
 * inferred `.tc` round-trips through the strict ohm grammar back to the same
 * typed contract. Single-channel response keys never clear the both-channels
 * fidelity bar.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { infer, renderDecision } from '../../packages/contract-verifier/src/infer/index.js';
import { parseTcFile } from '../../packages/contract-verifier/src/parser-ohm/index.js';
import { resolve } from '../../packages/contract-verifier/src/resolver/index.js';
import type { FieldExposureContract } from '../../packages/contract-verifier/src/types/index.js';

const FIXTURES = {
  js: path.resolve(__dirname, '../fixtures/sample-js-project-il'),
  py: path.resolve(__dirname, '../fixtures/sample-python-project-il'),
} as const;

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

for (const [lang, root] of Object.entries(FIXTURES)) {
  describe(`infer field-exposure — ${lang}`, () => {
    const codeDir = path.join(root, 'code');

    it('surfaces the planted both-channel exposures against an empty corpus', async () => {
      const res = await infer({ contractsDir: path.join(root, '__none__'), codeDir });
      const fe = res.decisions.filter((d) => d.kind === 'FieldExposure');
      expect(fe.length).toBeGreaterThan(0);
      // Every inferred exposure is on BOTH channels (the fidelity bar).
      for (const d of fe) {
        if (d.kind !== 'FieldExposure') continue;
        expect([...d.exposedVia].sort()).toEqual(['api-response', 'query-select']);
        expect(d.confidence).toBe('high');
        expect(d.codeLoc.path.length).toBeGreaterThan(0);
      }
      // The loyalty tier the profile read path exposes is among them.
      const fields = fe.map((d) => (d.kind === 'FieldExposure' ? norm(d.field) : ''));
      expect(fields).toContain('loyaltytier');
    });

    it('the inferred .tc round-trips through the ohm grammar as a FieldExposure', async () => {
      const res = await infer({ contractsDir: path.join(root, '__none__'), codeDir });
      const d = res.decisions.find((x) => x.kind === 'FieldExposure')!;
      const { tcSource, relPath } = renderDecision(d);
      const resolved = resolve([parseTcFile(relPath, tcSource)]);
      const hard = resolved.errors.filter((e) => (e.severity ?? 'hard') === 'hard');
      expect(hard, hard.map((e) => e.message).join('; ')).toEqual([]);
      const artifact = [...resolved.index.values()][0];
      expect(artifact?.ref.type).toBe('FieldExposure');
      expect(artifact?.provenance).toBe('inferred');
      const c = artifact?.contract as FieldExposureContract;
      expect([...c.exposedVia].sort()).toEqual(['api-response', 'query-select']);
    });

    it('does NOT re-surface the authored loyalty-tier exposure against the full corpus', async () => {
      const res = await infer({ contractsDir: path.join(root, 'reference/contracts'), codeDir });
      const fe = res.decisions.filter((d) => d.kind === 'FieldExposure');
      // The tier is documented; coverage subtraction drops it. Other
      // undocumented both-channel fields (id, email) still surface.
      const fields = fe.map((d) => (d.kind === 'FieldExposure' ? norm(d.field) : ''));
      expect(fields).not.toContain('loyaltytier');
      expect(fields.length).toBeGreaterThan(0);
    });
  });
}

describe('infer field-exposure — only both-channel exposures clear the fidelity bar', () => {
  it('skips a single-channel response key, surfaces a both-channel exposure', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-fe-'));
    try {
      fs.mkdirSync(path.join(dir, 'code'));
      fs.writeFileSync(
        path.join(dir, 'code', 'profile.ts'),
        [
          'export async function readProfile(db: any, id: string, res: { json: (b: unknown) => void }) {',
          // `score` is BOTH selected (projection) and returned (response) →
          // policy-grade, inferred.
          '  const row = await db.user.findUnique({ where: { id }, select: { score: true } });',
          '  res.json({ score: row.score });',
          '}',
          '',
          'export function listErrors(res: { json: (b: unknown) => void }, e: string) {',
          // `error` is only returned, never selected → incidental, skipped.
          '  res.json({ error: e });',
          '}',
          '',
        ].join('\n'),
      );
      const res = await infer({ contractsDir: path.join(dir, '__none__'), codeDir: path.join(dir, 'code') });
      const fe = res.decisions.filter((d) => d.kind === 'FieldExposure');
      const fields = fe.map((d) => (d.kind === 'FieldExposure' ? d.field : ''));
      expect(fields).toContain('score');
      expect(fields).not.toContain('error');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('infer field-exposure — structural coverage subtraction is name-independent', () => {
  it('an authored field-exposure with a different artifact name still covers the code exposure', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-fe-cov-'));
    try {
      fs.mkdirSync(path.join(dir, 'code'));
      fs.mkdirSync(path.join(dir, 'contracts'));
      // A field selected AND returned on the read path.
      fs.writeFileSync(
        path.join(dir, 'code', 'orders.ts'),
        [
          'export async function readOrder(db: any, id: string, res: { json: (b: unknown) => void }) {',
          '  const row = await db.order.findUnique({ where: { id }, select: { totalCents: true } });',
          '  res.json({ totalCents: row.totalCents });',
          '}',
          '',
        ].join('\n'),
      );
      // Empty corpus → the exposure surfaces.
      const uncovered = await infer({ contractsDir: path.join(dir, '__none__'), codeDir: path.join(dir, 'code') });
      expect(uncovered.decisions.some((d) => d.kind === 'FieldExposure' && norm(d.field) === 'totalcents')).toBe(true);

      // Author an exposure with a totally different name but the SAME field.
      fs.writeFileSync(
        path.join(dir, 'contracts', 'order-total.tc'),
        [
          'field-exposure order.some-other-name {',
          '  origin "SPEC.md" "Order read API" 1..3',
          '  field total_cents',
          '  via query-select',
          '  via api-response',
          '}',
          '',
        ].join('\n'),
      );
      const covered = await infer({ contractsDir: path.join(dir, 'contracts'), codeDir: path.join(dir, 'code') });
      expect(covered.decisions.some((d) => d.kind === 'FieldExposure' && norm(d.field) === 'totalcents')).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
