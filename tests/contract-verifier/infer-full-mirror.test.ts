/**
 * Full-mirror inference: the kinds whose code→contract extractor was added so
 * inference covers everything the spec can express. Most are cross-cutting
 * conventions already documented in the IL fixtures, so they're correctly
 * SILENT against the authored contracts. To exercise them positively we run
 * inference with an EMPTY authored corpus (nothing covered) — then every kind
 * the codebase exhibits must surface. This also proves coverage-subtraction:
 * same code, full contracts → silent; no contracts → fires.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { infer, renderDecision } from '../../packages/contract-verifier/src/infer/index.js';
import { parseTcFile as parseFile } from '../../packages/contract-verifier/src/parser-ohm/index.js';
import { resolve } from '../../packages/contract-verifier/src/resolver/index.js';

const FIXTURES = {
  js: path.resolve(__dirname, '../fixtures/sample-js-project-il'),
  py: path.resolve(__dirname, '../fixtures/sample-python-project-il'),
};

function kindsOf(decisions: { kind: string }[]): Set<string> {
  return new Set(decisions.map((d) => d.kind));
}

describe('full-mirror inference — empty corpus surfaces every kind', () => {
  it('JS: undocumented corpus yields the full artifact-kind spread', async () => {
    const root = FIXTURES.js;
    const res = await infer({ contractsDir: path.join(root, '__none__'), codeDir: path.join(root, 'code') });
    const kinds = kindsOf(res.decisions);
    for (const k of [
      'Operation', 'NamedConstant', 'Enum', 'QueryRule', 'ArchitectureDecision',
      'EffectGroup', 'Entity', 'PaginationContract', 'ErrorEnvelope',
      'AuthRequirement', 'IdempotencyContract', 'Formula',
    ]) {
      expect(kinds, `expected ${k} to be inferred`).toContain(k);
    }
  });

  it('Python: undocumented corpus yields the cross-cutting + structural kinds', async () => {
    const root = FIXTURES.py;
    const res = await infer({ contractsDir: path.join(root, '__none__'), codeDir: path.join(root, 'code') });
    const kinds = kindsOf(res.decisions);
    // No Prisma schema in the Python fixture, so no Entity — that's correct.
    for (const k of [
      'Operation', 'NamedConstant', 'Enum', 'QueryRule', 'EffectGroup',
      'PaginationContract', 'ErrorEnvelope', 'AuthRequirement', 'Formula',
    ]) {
      expect(kinds, `expected ${k} to be inferred`).toContain(k);
    }
  });

  it('every rendered inferred artifact is valid .tc that resolves as inferred', async () => {
    const root = FIXTURES.js;
    const res = await infer({ contractsDir: path.join(root, '__none__'), codeDir: path.join(root, 'code') });
    for (const d of res.decisions) {
      const { tcSource, relPath } = renderDecision(d);
      const resolved = resolve([parseFile(relPath, tcSource)]);
      const hard = resolved.errors.filter((e) => (e.severity ?? 'hard') === 'hard');
      expect(hard, `hard resolve error in ${relPath}: ${hard.map((e) => e.message).join('; ')}`).toEqual([]);
      const artifact = [...resolved.index.values()][0];
      expect(artifact?.provenance, relPath).toBe('inferred');
    }
  });

  it('cross-cutting + structural kinds are SILENT when the spec already covers them', async () => {
    const root = FIXTURES.js;
    const res = await infer({ contractsDir: path.join(root, 'reference/contracts'), codeDir: path.join(root, 'code') });
    const kinds = kindsOf(res.decisions);
    // The fixture documents auth, error-envelope, pagination, idempotency,
    // the order effect-group, the pricing formulas, and its entities — so none
    // of those should be inferred against the full authored corpus.
    for (const k of [
      'EffectGroup', 'Entity', 'PaginationContract', 'ErrorEnvelope',
      'AuthRequirement', 'IdempotencyContract', 'Formula', 'StateMachine',
    ]) {
      expect(kinds, `${k} should be covered (silent) against full contracts`).not.toContain(k);
    }
  });
});

describe('state-machine inference — cohesive multi-literal status field', () => {
  it('infers a state machine when a field is assigned ≥2 enum-member literals', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-sm-'));
    try {
      fs.mkdirSync(path.join(dir, 'code'));
      fs.writeFileSync(
        path.join(dir, 'code', 'ticket.ts'),
        [
          "export type TicketStatus = 'open' | 'assigned' | 'resolved' | 'closed';",
          '',
          'export function advance(ticket: { status: TicketStatus }, action: string): void {',
          "  if (action === 'assign') ticket.status = 'assigned';",
          "  else if (action === 'resolve') ticket.status = 'resolved';",
          "  else if (action === 'close') ticket.status = 'closed';",
          '}',
          '',
        ].join('\n'),
      );
      const res = await infer({ contractsDir: path.join(dir, '__none__'), codeDir: path.join(dir, 'code') });
      const sm = res.decisions.find((d) => d.kind === 'StateMachine');
      expect(sm).toBeDefined();
      expect(sm!.identity).toBe('ticket.status');
      expect(sm!.confidence).toBe('low'); // transitions not recovered — a draft
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
