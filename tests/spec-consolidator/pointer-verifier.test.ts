/**
 * Conflict section pointers are model-chosen and UNVALIDATED: the judge names
 * "the nearest heading above the conflicting sentence" and can
 * mis-anchor — the live bug pointed taskline's README `rm` conflict at `## Storage`
 * when the disputed sentence lives in the doc's LEAD. `verifyConflictSides`
 * re-anchors deterministically from the doc's own content (no LLM), and running
 * it at assembly BEFORE the cross-area dedup makes the fewest-null representative
 * choice trustworthy.
 *
 * Fixtures follow the taskline SHAPE (a doc whose lead states the disputed rule
 * while a later Storage section only mentions it in passing) — not its literal
 * prose — so the scoring is exercised, not memorized.
 */
import { describe, it, expect } from 'vitest';
import { splitDocSections, verifyConflictSides } from '../../packages/spec-consolidator/src/index.js';
import { dedupeCrossAreaConflicts, parseHeadings } from '@truecourse/shared';
import type { Conflict } from '../../packages/spec-consolidator/src/index.js';

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

describe('verifyConflictSides', () => {
  it('re-anchors a mis-pointed README side (Storage → the lead) when the lead holds the claim', () => {
    const out = verifyConflictSides({
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
    const out = verifyConflictSides({
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
    const out = verifyConflictSides({
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
    const out = verifyConflictSides({
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
    const out = verifyConflictSides({
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
    const out = verifyConflictSides({
      docs: ['README.md', 'docs/SPEC.md'],
      note: NOTE,
      sections: [{ doc: 'README.md', heading: 'Deletion Policy' }],
      bodyOf: bodyOf({ 'README.md': README_MD }),
    });
    expect(out).toEqual([{ doc: 'README.md', heading: null }]);
  });

  it('is a no-op on an conflict with no section pointers', () => {
    const out = verifyConflictSides({
      docs: ['a.md', 'b.md'],
      note: NOTE,
      sections: [],
      bodyOf: bodyOf({}),
    });
    expect(out).toEqual([]);
  });

  it('keeps pointers when the doc body is unresolvable', () => {
    const out = verifyConflictSides({
      docs: ['README.md', 'docs/SPEC.md'],
      note: NOTE,
      sections: [{ doc: 'README.md', heading: 'Storage' }],
      bodyOf: () => undefined,
    });
    expect(out).toEqual([{ doc: 'README.md', heading: 'Storage' }]);
  });
});

// A verbatim quote upgrades verification from token-conflict to EXACT location.
// A located quote anchors with certainty (skipping token scoring); a quote found
// nowhere falls back to the token path unchanged.
describe('verifyConflictSides — a located verbatim quote anchors with certainty', () => {
  it('re-anchors with certainty: quote of the rm sentence found in the lead → null even though the model said Storage', () => {
    const out = verifyConflictSides({
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
    const out = verifyConflictSides({
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
    const out = verifyConflictSides({
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
    const out = verifyConflictSides({
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
// Verification runs BEFORE dedup — now in the conflict SESSION's fold
//
// `flagOverlaps` retired with the one-shot detector. The rule
// it enforced did not: the run's fold re-anchors every session pointer with
// `verifyConflictSides` BEFORE `dedupeCrossAreaConflicts` merges the same
// disagreement across the areas that share the pair. This case drives the two
// deterministic halves in that order, exactly as `services/spec-scan/run.ts`
// chains them. (The end-to-end path through a scripted session driver lives in
// `tests/core/spec-scan-conflict.test.ts`.)
// ---------------------------------------------------------------------------

describe('verification before dedup', () => {
  it('converges a wrong-named duplicate onto the verified lead anchor and merges to one record', () => {
    // The live bug: the SAME README+SPEC `rm` conflict is flagged in two shared
    // areas. One area\'s session anchors the README side at the LEAD (null,
    // correct); the other at `## Storage` (wrong-but-NAMED). Un-verified, the
    // fewest-null dedup rule would keep the wrong-named record as the
    // representative. Verified first, the Storage anchor re-anchors to the lead,
    // so BOTH agree and the surviving record carries the correct null pointer.
    const bodies = bodyOf({ 'README.md': README_MD, 'docs/SPEC.md': SPEC_MD });
    const flagged = [
      { area: 'core/persistence', heading: null as string | null },
      { area: 'core/tasks-entity', heading: 'Storage' as string | null },
    ];
    const entries = flagged.map(({ area, heading }) => ({
      area,
      conflict: {
        docs: ['README.md', 'docs/SPEC.md'] as [string, string],
        note: NOTE,
        areas: [] as string[],
        sections: verifyConflictSides({
          docs: ['README.md', 'docs/SPEC.md'],
          note: NOTE,
          sections: [
            { doc: 'README.md', heading },
            { doc: 'docs/SPEC.md', heading: '`rm <id>`' },
          ],
          bodyOf: bodies,
        }),
      } satisfies Conflict,
    }));

    const merged = dedupeCrossAreaConflicts(entries);

    // One merged record, under the representative (lexicographically-first) area.
    expect(merged).toHaveLength(1);
    expect(merged[0].area).toBe('core/persistence');
    expect(merged[0].areas).toEqual(['core/persistence', 'core/tasks-entity']);
    // The README side is the verified LEAD anchor (null), NOT the mis-anchored Storage.
    expect(merged[0].conflict.sections).toContainEqual({ doc: 'README.md', heading: null });
    expect(merged[0].conflict.sections).not.toContainEqual({ doc: 'README.md', heading: 'Storage' });
    expect(merged[0].conflict.sections).toContainEqual({ doc: 'docs/SPEC.md', heading: '`rm <id>`' });
  });
});

// ---------------------------------------------------------------------------
// Sections are the outline's sections
//
// A doc's sections split at exactly the headings `parseHeadings` finds, the
// scanner the outline, `read_section` and the unit splitter use: a `# comment`
// inside a fenced block is code, never a section, and a closing hash run is
// not part of the heading.
// ---------------------------------------------------------------------------

const INSTALL_MD = `# Install

Run the installer once.

## Setup

\`\`\`bash
# Install the dependencies
pnpm install
# Start the server
pnpm dev --port 3000
\`\`\`

The server listens on port 3000.

## Upgrade ##

~~~sh
#!/bin/sh
## not a heading either
~~~

Upgrades keep your data.
`;

describe('splitDocSections follows the outline', () => {
  it('splits at the headings parseHeadings finds, never at a comment inside a fence', () => {
    const sections = splitDocSections(INSTALL_MD, new Set());
    expect(sections.map((s) => s.realHeading)).toEqual(['Install', 'Setup', 'Upgrade']);
    expect(sections.map((s) => s.realHeading)).toEqual(parseHeadings(INSTALL_MD.split('\n')).map((h) => h.text));
    // The fence stays whole inside its section.
    expect(sections[1]!.text).toContain('# Start the server\npnpm dev --port 3000\n```\n\nThe server listens on port 3000.');
  });

  it('keeps a pointer whose quote sits below a comment line inside a fence', () => {
    const out = verifyConflictSides({
      docs: ['docs/install.md', 'docs/ops.md'],
      note: 'install.md runs the server on port 3000; ops.md says 8080',
      sections: [{ doc: 'docs/install.md', heading: 'Setup', quote: 'pnpm dev --port 3000' }],
      bodyOf: bodyOf({ 'docs/install.md': INSTALL_MD }),
    });
    expect(out).toEqual([{ doc: 'docs/install.md', heading: 'Setup', quote: 'pnpm dev --port 3000' }]);
  });

  it('names a heading with a closing hash run as the outline does', () => {
    const out = verifyConflictSides({
      docs: ['docs/install.md', 'docs/ops.md'],
      note: 'upgrades keep data in install.md, not in ops.md',
      sections: [{ doc: 'docs/install.md', heading: 'Setup', quote: 'Upgrades keep your data.' }],
      bodyOf: bodyOf({ 'docs/install.md': INSTALL_MD }),
    });
    expect(out).toEqual([{ doc: 'docs/install.md', heading: 'Upgrade', quote: 'Upgrades keep your data.' }]);
  });
});
