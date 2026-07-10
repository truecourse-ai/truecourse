/**
 * Overlap section pointers are model-chosen and UNVALIDATED (spec-scan item 29):
 * the judge names "the nearest heading above the conflicting passage" and can
 * mis-anchor — the live bug pointed taskline's README `rm` dispute at `## Storage`
 * when the disputed sentence lives in the doc's LEAD. `verifyOverlapSections`
 * re-anchors deterministically from the doc's own content (no LLM), and running
 * it at assembly BEFORE the cross-area dedup makes the fewest-null representative
 * choice trustworthy.
 *
 * Fixtures follow the taskline SHAPE (a doc whose lead states the disputed rule
 * while a later Storage section only mentions it in passing) — not its literal
 * prose — so the scoring is exercised, not memorized.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import { flagOverlaps, verifyOverlapSections } from '../../packages/spec-consolidator/src/index.js';
import type { Area, DocCandidate, OverlapRunner } from '../../packages/spec-consolidator/src/index.js';

// A README whose LEAD (the H1 + intro, before `## Install`) states the disputed
// deletion rule; the later `## Storage` section talks about the JSON file and ids
// and only mentions "tasks" in passing — the exact taskline mis-anchor shape.
const README_MD = `# tasktrack

tasktrack is a tiny terminal task tracker. It stores tasks in one JSON file and
\`rm\` deletes a task permanently — there is no trash can to empty.

## Install

npm install -g tasktrack

## Commands

| Command | What it does |
| --- | --- |
| \`rm <id>\` | Remove a task. |

## Storage

State lives in \`.tasktrack/tasks.json\`. Ids are handed out sequentially and are
never reused.
`;

// The behavior spec: the \`rm <id>\` section is where deletion/archival is actually
// specified — the CORRECT anchor for that side.
const SPEC_MD = `# tasktrack behavior spec

## Storage

Tasks are persisted in \`.tasktrack/tasks.json\`.

## \`rm <id>\`

Removes a task and prints a confirmation. Removed tasks are archived and remain
restorable for 7 days before they are purged.
`;

const NOTE =
  'README.md states `rm` deletes tasks permanently with no trash can; ' +
  'SPEC.md states removed tasks are archived and remain restorable for 7 days before purging';

const bodyOf = (m: Record<string, string>) => (ref: string): string | undefined => m[ref];

describe('verifyOverlapSections', () => {
  it('re-anchors a mis-pointed README side (Storage → the lead) when the lead holds the claim', () => {
    const out = verifyOverlapSections({
      docs: ['README.md', 'docs/SPEC.md'],
      note: NOTE,
      sections: [
        { doc: 'README.md', heading: 'Storage' }, // model mis-anchored
        { doc: 'docs/SPEC.md', heading: '`rm <id>`' }, // correct
      ],
      bodyOf: bodyOf({ 'README.md': README_MD, 'docs/SPEC.md': SPEC_MD }),
    });
    // README moves to the lead (null); SPEC keeps its correct pointer.
    expect(out).toEqual([
      { doc: 'README.md', heading: null },
      { doc: 'docs/SPEC.md', heading: '`rm <id>`' },
    ]);
  });

  it('keeps a correct pointer whose section discusses the disputed behavior', () => {
    // The SPEC `rm <id>` section is where removal/archival is specified — the
    // best-scoring section — so it is the anchor and stays put.
    const out = verifyOverlapSections({
      docs: ['README.md', 'docs/SPEC.md'],
      note: NOTE,
      sections: [{ doc: 'docs/SPEC.md', heading: '`rm <id>`' }],
      bodyOf: bodyOf({ 'docs/SPEC.md': SPEC_MD }),
    });
    expect(out).toEqual([{ doc: 'docs/SPEC.md', heading: '`rm <id>`' }]);
  });

  it('keeps a null (lead) pointer that correctly holds the claim', () => {
    // The README lead genuinely states the rule, so a null pointer is already
    // right and is left untouched — never bounced to some lower-scoring heading.
    const out = verifyOverlapSections({
      docs: ['README.md', 'docs/SPEC.md'],
      note: NOTE,
      sections: [{ doc: 'README.md', heading: null }],
      bodyOf: bodyOf({ 'README.md': README_MD }),
    });
    expect(out).toEqual([{ doc: 'README.md', heading: null }]);
  });

  it('keeps a pointer with partial-but-real signal even when another section scores higher (no override-happiness)', () => {
    const DOC = `# widget store

## Deletion

Deleting a widget removes it permanently from the catalog.

## Trash

Deleted widgets move to the trash and stay restorable for thirty days before
they are purged.
`;
    const note =
      'app.md says deletion removes a widget permanently; ' +
      'store.md says deleted widgets move to trash and stay restorable for thirty days';
    // "Deletion" shares deletion/removes/permanently with the note (real signal)
    // while "Trash" shares more — but a section that carries meaningful signal is
    // KEPT, not upgraded to the highest scorer.
    const out = verifyOverlapSections({
      docs: ['app.md', 'store.md'],
      note,
      sections: [{ doc: 'app.md', heading: 'Deletion' }],
      bodyOf: bodyOf({ 'app.md': DOC }),
    });
    expect(out).toEqual([{ doc: 'app.md', heading: 'Deletion' }]);
  });

  it('leaves a pointer unchanged when the note shares no distinctive token with any section', () => {
    const DOC = `# billing

## Invoices

Monthly invoices are generated on the first of each month.

## Refunds

Refunds are issued within five business days.
`;
    // The note is about pagination; nothing in the doc matches, so no candidate
    // scores and the pointer is left exactly as the model set it.
    const note = 'a.md and b.md disagree about the pagination cursor page size';
    const out = verifyOverlapSections({
      docs: ['a.md', 'b.md'],
      note,
      sections: [
        { doc: 'a.md', heading: 'Invoices' },
        { doc: 'a.md', heading: null },
      ],
      bodyOf: bodyOf({ 'a.md': DOC }),
    });
    expect(out).toEqual([
      { doc: 'a.md', heading: 'Invoices' },
      { doc: 'a.md', heading: null },
    ]);
  });

  it('re-anchors a hallucinated heading (names a section that does not exist) to the real anchor', () => {
    // A pointer naming a non-existent heading scores 0 and re-anchors to the lead
    // when the lead clearly holds the claim.
    const out = verifyOverlapSections({
      docs: ['README.md', 'docs/SPEC.md'],
      note: NOTE,
      sections: [{ doc: 'README.md', heading: 'Deletion Policy' }],
      bodyOf: bodyOf({ 'README.md': README_MD }),
    });
    expect(out).toEqual([{ doc: 'README.md', heading: null }]);
  });

  it('is a no-op on an overlap with no section pointers', () => {
    const out = verifyOverlapSections({
      docs: ['a.md', 'b.md'],
      note: NOTE,
      sections: [],
      bodyOf: bodyOf({}),
    });
    expect(out).toEqual([]);
  });

  it('keeps pointers when the doc body is unresolvable', () => {
    const out = verifyOverlapSections({
      docs: ['README.md', 'docs/SPEC.md'],
      note: NOTE,
      sections: [{ doc: 'README.md', heading: 'Storage' }],
      bodyOf: () => undefined,
    });
    expect(out).toEqual([{ doc: 'README.md', heading: 'Storage' }]);
  });
});

// Item 30: a verbatim quote upgrades verification from token-overlap to EXACT
// location. A located quote anchors with certainty (skipping token scoring); a
// quote found nowhere falls back to the token path unchanged.
describe('verifyOverlapSections — verbatim quote location (item 30)', () => {
  it('re-anchors with certainty: quote of the rm sentence found in the lead → null even though the model said Storage', () => {
    const out = verifyOverlapSections({
      docs: ['README.md', 'docs/SPEC.md'],
      note: NOTE,
      sections: [
        // The model mis-anchored to Storage but quoted the LEAD's rm sentence verbatim.
        { doc: 'README.md', heading: 'Storage', quote: 'rm deletes a task permanently' },
      ],
      bodyOf: bodyOf({ 'README.md': README_MD }),
    });
    // The quote locates the lead → re-anchor to null, quote preserved.
    expect(out).toEqual([{ doc: 'README.md', heading: null, quote: 'rm deletes a task permanently' }]);
  });

  it('keeps a correct pointer whose quote is located in the pointed section (certainty keep)', () => {
    const out = verifyOverlapSections({
      docs: ['README.md', 'docs/SPEC.md'],
      note: NOTE,
      sections: [
        { doc: 'docs/SPEC.md', heading: '`rm <id>`', quote: 'Removed tasks are archived and remain restorable for 7 days' },
      ],
      bodyOf: bodyOf({ 'docs/SPEC.md': SPEC_MD }),
    });
    expect(out).toEqual([
      { doc: 'docs/SPEC.md', heading: '`rm <id>`', quote: 'Removed tasks are archived and remain restorable for 7 days' },
    ]);
  });

  it('falls back to token scoring when the quote is found nowhere (still re-anchors Storage → lead)', () => {
    const out = verifyOverlapSections({
      docs: ['README.md', 'docs/SPEC.md'],
      note: NOTE,
      sections: [
        { doc: 'README.md', heading: 'Storage', quote: 'a sentence that never appears in the document at all' },
      ],
      bodyOf: bodyOf({ 'README.md': README_MD }),
    });
    // No quote hit → the existing token path moves Storage → the lead; quote rides along.
    expect(out).toEqual([
      { doc: 'README.md', heading: null, quote: 'a sentence that never appears in the document at all' },
    ]);
  });

  it('normalizes backticks + whitespace when locating the quote', () => {
    const out = verifyOverlapSections({
      docs: ['README.md', 'docs/SPEC.md'],
      note: NOTE,
      // Backticks around `rm`, collapsed em-dash spacing, and a line break — the
      // source wraps the sentence and styles `rm` in code; normalization matches it.
      sections: [{ doc: 'README.md', heading: 'Commands', quote: '`rm`  deletes  a  task\npermanently' }],
      bodyOf: bodyOf({ 'README.md': README_MD }),
    });
    // Located in the lead despite the wrong heading + reformatting → null.
    expect(out[0].heading).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Verification runs BEFORE dedup at assembly (flagOverlaps)
// ---------------------------------------------------------------------------

function doc(p: string, content: string): DocCandidate {
  return {
    path: p,
    absPath: `/abs/${p}`,
    content,
    kind: 'prd',
    preview: content.split('\n').slice(0, 5).join('\n'),
    lastTouched: '2026-01-01T00:00:00Z',
    contentHash: `hash-${p}`,
    size: content.length,
  };
}

function area(id: string, refs: string[]): Area {
  const slash = id.indexOf('/');
  return { id, product: id.slice(0, slash), concern: id.slice(slash + 1), docRefs: refs, overlaps: [] };
}

let repo: string;
beforeEach(() => {
  resetKvCacheStore();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ptr-verify-'));
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

describe('flagOverlaps — verification before dedup', () => {
  it('converges a wrong-named duplicate onto the verified lead anchor and merges to one record', async () => {
    // The live bug: the SAME README+SPEC `rm` dispute is flagged in two shared
    // areas. One flag anchors the README side at the LEAD (null, correct); the
    // other at `## Storage` (wrong-but-NAMED). Before verification the fewest-null
    // dedup rule would keep the wrong-named record as the representative. With
    // verification the Storage anchor re-anchors to the lead first, so BOTH agree
    // and the surviving record carries the correct null (lead) pointer.
    const docs = [doc('README.md', README_MD), doc('docs/SPEC.md', SPEC_MD)];
    const areas = [
      area('core/persistence', ['README.md', 'docs/SPEC.md']),
      area('core/tasks-entity', ['README.md', 'docs/SPEC.md']),
    ];
    const runner: OverlapRunner = async ({ areaId }) => ({
      overlap: true,
      note: NOTE,
      sections: [
        // persistence anchors the README side at the lead; tasks-entity at Storage.
        { doc: 'README.md', heading: areaId === 'core/tasks-entity' ? 'Storage' : null },
        { doc: 'docs/SPEC.md', heading: '`rm <id>`' },
      ],
    });
    const out = await flagOverlaps(repo, areas, docs, { runner });

    // One merged record, under the representative (lexicographically-first) area.
    expect(out.get('core/persistence')).toHaveLength(1);
    expect(out.has('core/tasks-entity')).toBe(false);
    const rec = out.get('core/persistence')![0];
    expect(rec.areas).toEqual(['core/persistence', 'core/tasks-entity']);
    // The README side is the verified LEAD anchor (null), NOT the mis-anchored Storage.
    expect(rec.sections).toContainEqual({ doc: 'README.md', heading: null });
    expect(rec.sections).not.toContainEqual({ doc: 'README.md', heading: 'Storage' });
    expect(rec.sections).toContainEqual({ doc: 'docs/SPEC.md', heading: '`rm <id>`' });
  });
});
