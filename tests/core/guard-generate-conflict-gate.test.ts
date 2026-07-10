/**
 * The guard-generate conflict gate: `guardGenerateInProcess` hard-fails BEFORE
 * the estimate/confirm when the corpus has an unresolved within-area overlap —
 * extracting both sides would birth a paid finding that is really the dispute.
 * A resolution the surfaces recognise (a covering relation, or a force-exclude of
 * one side) lets generate proceed past the gate to the estimate.
 *
 * Seeds corpus.json + decisions.json directly (no LLM, no re-scan). "Proceeds" is
 * proven by declining the estimate (`onLlmEstimate → false` ⇒ EstimateDeclined):
 * reaching the estimate means the gate let it through, and nothing was spent.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  guardGenerateInProcess,
  OpenConflictsError,
  EstimateDeclined,
} from '../../packages/core/src/commands/guard-in-process.js';
import { resetSpecStore } from '../../packages/core/src/lib/spec-store.js';

let repo: string;

const NOTE = 'auth0_id vs auth0_sub for the user identity';

function seedCorpusWithOverlap(): void {
  const corpus = {
    version: 3,
    generatedAt: '2026-01-01T00:00:00Z',
    docs: [
      { ref: 'docs/v1.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['booking/users-entity'] },
      { ref: 'docs/v2.md', kind: 'prd', lastTouched: '2026-02-01T00:00:00Z', areaTags: ['booking/users-entity'] },
    ],
    areas: [
      {
        id: 'booking/users-entity',
        product: 'booking',
        concern: 'users-entity',
        docRefs: ['docs/v1.md', 'docs/v2.md'],
        overlaps: [{ docs: ['docs/v1.md', 'docs/v2.md'], note: NOTE, sections: [] }],
      },
    ],
    relations: [],
    skippedDocs: [],
  };
  fs.writeFileSync(path.join(repo, '.truecourse', 'specs', 'corpus.json'), JSON.stringify(corpus));
}

function writeDecisions(decisions: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(repo, '.truecourse', 'specs', 'decisions.json'),
    JSON.stringify({ version: 1, manualIncludes: [], manualExcludes: [], relations: [], manualAreas: [], ...decisions }),
  );
}

beforeEach(() => {
  resetSpecStore();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-gate-'));
  fs.mkdirSync(path.join(repo, '.truecourse', 'specs'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'docs', 'v1.md'), '# Users v1\nThe user identity is auth0_id.');
  fs.writeFileSync(path.join(repo, 'docs', 'v2.md'), '# Users v2\nThe user identity is auth0_sub.');
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('guard generate — open-conflict gate', () => {
  it('hard-fails on an open overlap with the full conflict list, before any estimate', async () => {
    seedCorpusWithOverlap();
    // The estimate must NEVER be reached (never ask to spend, then fail).
    let estimateReached = false;
    const err = await guardGenerateInProcess(repo, {
      onLlmEstimate: async () => {
        estimateReached = true;
        return true;
      },
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(OpenConflictsError);
    expect(estimateReached).toBe(false);

    const conflicts = (err as OpenConflictsError).conflicts;
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ area: 'booking/users-entity', a: 'docs/v1.md', b: 'docs/v2.md', note: NOTE });

    // The message carries BOTH doc paths + the full note + the resolution pointers.
    const msg = (err as OpenConflictsError).message;
    expect(msg).toContain('docs/v1.md');
    expect(msg).toContain('docs/v2.md');
    expect(msg).toContain(NOTE);
    expect(msg).toContain('truecourse spec conflicts list');
    expect(msg).toContain('truecourse guard generate');
  });

  it('proceeds past the gate when a covering relation resolves the overlap', async () => {
    seedCorpusWithOverlap();
    writeDecisions({
      relations: [{ type: 'precedence', older: 'docs/v1.md', newer: 'docs/v2.md', scope: 'booking/users-entity', detectedFrom: 'manual' }],
    });
    const err = await guardGenerateInProcess(repo, { onLlmEstimate: async () => false }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(OpenConflictsError);
    expect(err).toBeInstanceOf(EstimateDeclined);
  });

  it('proceeds past the gate when a force-exclude drops one side of the overlap', async () => {
    seedCorpusWithOverlap();
    writeDecisions({ manualExcludes: ['docs/v1.md'] });
    const err = await guardGenerateInProcess(repo, { onLlmEstimate: async () => false }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(OpenConflictsError);
    expect(err).toBeInstanceOf(EstimateDeclined);
  });
});
