/**
 * A contradiction INSIDE one document, through the consolidator's deterministic
 * tail: its pointers re-anchor one sentence at a time and keep their order, it
 * is filed under the doc's own area, a high-confidence pick is recorded against
 * the sentence it names, and the prune keeps its verdict while the doc stays.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  autoApplyHighConfidenceRecommendations,
  pruneOrphanedConflictResolutions,
} from '../../packages/spec-consolidator/src/curate.js';
import { assignDocPairArea } from '../../packages/spec-consolidator/src/area-grouper.js';
import { decisionsPath } from '../../packages/spec-consolidator/src/orchestrator.js';
import type { DecisionsFile } from '../../packages/spec-consolidator/src/types.js';
import type { CuratedCorpus, Conflict } from '../../packages/spec-consolidator/src/corpus-types.js';
import { sentenceKey } from '../../packages/shared/src/spec/conflict-resolution.js';

const DOC = 'docs/DESIGN.md';
const BODY = `# Design

## Buttons

A press translates the button down 1px.

## Motion

A press scales the button to 0.97.
`;

const PRESS = { doc: DOC, quote: 'A press translates the button down 1px.', sentence: sentenceKey('A press translates the button down 1px.') };
const SCALE = { doc: DOC, quote: 'A press scales the button to 0.97.', sentence: sentenceKey('A press scales the button to 0.97.') };

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-same-doc-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

function corpusWith(conflict: Conflict): CuratedCorpus {
  return {
    version: 6,
    generatedAt: '2026-10-01T00:00:00Z',
    docs: [{ ref: DOC, kind: 'unknown', lastTouched: '2026-10-01T00:00:00Z', areaTags: ['core/design'] }],
    areas: [{ id: 'core/design', product: 'core', concern: 'design', docRefs: [DOC], conflicts: [conflict] }],
    skippedDocs: [],
  } as CuratedCorpus;
}

const EMPTY: DecisionsFile = {
  version: 2,
  manualIncludes: [],
  manualExcludes: [],
  manualAreas: [],
  conflictResolutions: [],
  scopeVerdicts: [],
  instructions: [],
};

describe('assignDocPairArea on one doc', () => {
  it('files the conflict under the first of the doc\'s own areas', () => {
    expect(assignDocPairArea(DOC, DOC, new Map([[DOC, ['core/z', 'core/design']]]))).toBe('core/design');
  });
});

describe('autoApplyHighConfidenceRecommendations on one doc', () => {
  it('records a high-confidence pick-b against the SECOND sentence', () => {
    const corpus = corpusWith({
      docs: [DOC, DOC],
      note: 'DESIGN.md says a press translates and scales',
      areas: ['core/design'],
      sections: [PRESS, SCALE],
      review: {
        explanation: 'Buttons says translate, Motion says scale.',
        recommendation: { action: 'pick-b', rationale: 'Motion is the newer section.', confidence: 'high' },
      },
    });
    const { decisions, applied } = autoApplyHighConfidenceRecommendations(repo, corpus, EMPTY);
    expect(applied).toEqual([{ area: 'core/design', a: DOC, b: DOC, verdict: 'b' }]);
    expect(decisions.conflictResolutions).toEqual([
      expect.objectContaining({
        docA: DOC,
        quoteA: PRESS.quote,
        sentenceA: PRESS.sentence,
        docB: DOC,
        quoteB: SCALE.quote,
        sentenceB: SCALE.sentence,
        verdict: 'b',
        resolvedBy: 'auto',
      }),
    ]);
    // Applied once: the next pass finds the conflict resolved.
    expect(autoApplyHighConfidenceRecommendations(repo, corpus, decisions).applied).toEqual([]);
  });
});

describe('pruneOrphanedConflictResolutions on one doc', () => {
  it('keeps a verdict inside a doc the corpus still holds', () => {
    const corpus = corpusWith({ docs: [DOC, DOC], note: 'n', sections: [PRESS, SCALE], areas: ['core/design'] });
    const decisions: DecisionsFile = {
      ...EMPTY,
      conflictResolutions: [
        { docA: DOC, sentenceA: PRESS.sentence, docB: DOC, sentenceB: SCALE.sentence, verdict: 'a', resolvedAt: '2026-10-01T00:00:00Z' },
      ],
    };
    expect(pruneOrphanedConflictResolutions(repo, corpus, decisions)).toBe(decisions);
    expect(fs.existsSync(decisionsPath(repo))).toBe(false);
  });
});
